'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const {StringDecoder} = require('node:string_decoder');
const {UsageAccumulator} = require('./usage-data.cjs');
const CHANNEL = 'codex-usage-ui:read-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 仅在测试页或独立诊断进程中执行，记录字形与图标的实际位置供截图核对。
function measureMetricGeometry(container) {
  if(!container)return null;
  const canvas=document.createElement('canvas').getContext('2d');
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const metrics=[...container.querySelectorAll('.cu-metric-label')].map(label=>{
    const style=getComputedStyle(label),row=label.parentElement.getBoundingClientRect();
    canvas.font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
    const t=canvas.measureText(label.textContent),marker=document.createElement('i');
    marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';label.append(marker);
    const baseline=marker.getBoundingClientRect().top;marker.remove();
    const scale=label.getBoundingClientRect().height/(parseFloat(style.height)||20);
    const textCenter=baseline+(t.actualBoundingBoxDescent-t.actualBoundingBoxAscent)*scale/2;
    const svg=label.parentElement.querySelector('svg');let iconCenter=null;
    if(svg){const b=svg.getBBox(),m=svg.getScreenCTM();iconCenter=m.b*(b.x+b.width/2)+m.d*(b.y+b.height/2)+m.f;}
    return {text:label.textContent,font:canvas.font,baseline,textCenter,iconCenter,rowCenter:row.top+row.height/2,labelBounds:rect(label),iconBounds:svg?rect(svg):null};
  });
  return {metrics,viewport:{width:visualViewport?.width??innerWidth,height:visualViewport?.height??innerHeight,scale:devicePixelRatio},maxTextOffset:Math.max(0,...metrics.map(m=>Math.abs(m.textCenter-m.rowCenter))),maxIconOffset:Math.max(0,...metrics.filter(m=>m.iconCenter!=null).map(m=>Math.abs(m.iconCenter-m.rowCenter)))};
}

class RolloutStore {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    this.home = home; this.files = new Map(); this.cache = new Map(); this.lastIndex = 0; this.indexPromise = null;
    this.latestLimits = null; this.lastQuotaCheck = 0;
  }
  async index() {
    if (this.indexPromise) return this.indexPromise;
    if (Date.now()-this.lastIndex < 30000) return;
    this.indexPromise = (async()=>{
      for (const root of ['sessions','archived_sessions']) {
        const visit = async dir => {
          let entries; try { entries = await fsp.readdir(dir, {withFileTypes:true}); } catch { return; }
          for (const e of entries) {
            const p = path.join(dir,e.name);
            if (e.isDirectory()) await visit(p);
            else if (e.isFile() && e.name.endsWith('.jsonl')) {
              const id = e.name.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1];
              if (id) this.files.set(id,p);
            }
          }
        };
        await visit(path.join(this.home,root));
      }
      this.lastIndex = Date.now();
    })().finally(()=>{this.indexPromise=null});
    return this.indexPromise;
  }
  async read(id) {
    if (id !== null && !UUID.test(id)) throw new Error('会话 ID 无效');
    await this.index();
    if (!id) {
      if (Date.now()-this.lastQuotaCheck > 30000) {
        this.lastQuotaCheck=Date.now();
        // 首页没有当前会话，从最近的日志尾部寻找真实额度，不扫描聊天正文。
        const recent=[...this.files.values()].sort().reverse().slice(0,20);
        for (const file of recent) {
          let handle;
          try {
            const stat=await fsp.stat(file);handle=await fsp.open(file,'r');
            const length=Math.min(stat.size,512*1024), buf=Buffer.alloc(length);
            await handle.read(buf,0,length,stat.size-length);
            for (const line of buf.toString('utf8').split('\n').reverse()) {
              if(!line.includes('"rate_limits"'))continue;
              try {
                const e=JSON.parse(line);
                if(e.type==='event_msg' && e.payload?.type==='token_count' && e.payload.rate_limits){
                  const {normalizeLimits}=require('./usage-data.cjs');
                  const limits=normalizeLimits(e.payload.rate_limits,Date.parse(e.timestamp));
                  if(limits && (!this.latestLimits || limits.observedAt>this.latestLimits.observedAt))this.latestLimits=limits;
                  break;
                }
              } catch {}
            }
          } catch {} finally { if(handle)await handle.close(); }
        }
      }
      return {threadId:null, available:false, limits:this.latestLimits};
    }
    let filename = this.files.get(id);
    if (!filename) return {threadId:id, available:false, limits:this.latestLimits, reason:'暂未找到本地会话日志'};
    const stat = await fsp.stat(filename);
    let c = this.cache.get(id);
    if (!c || c.position > stat.size || c.filename !== filename) {
      c = {filename,position:0,remainder:'',decoder:new StringDecoder('utf8'),acc:new UsageAccumulator()}; this.cache.set(id,c);
    }
    if (!c.reading) c.reading = this.update(c,stat.size).finally(()=>{c.reading=null});
    await c.reading;
    this.cache.delete(id); this.cache.set(id,c);
    while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    const snapshot = c.acc.snapshot();
    if (snapshot.limits && (!this.latestLimits || snapshot.limits.observedAt > this.latestLimits.observedAt)) this.latestLimits = snapshot.limits;
    return {...snapshot,threadId:id,limits:this.latestLimits ?? snapshot.limits,updatedAt:stat.mtimeMs};
  }
  async update(c,size) {
    if (c.position === size) return;
    const handle = await fsp.open(c.filename,'r');
    try {
      while (c.position < size) {
        const bytes = Buffer.alloc(Math.min(256*1024,size-c.position));
        const {bytesRead} = await handle.read(bytes,0,bytes.length,c.position);
        if (!bytesRead) break;
        c.position += bytesRead;
        const lines = (c.remainder+c.decoder.write(bytes.subarray(0,bytesRead))).split('\n');
        c.remainder = lines.pop();
        for (const line of lines) {
          // 只解析计数与时钟事件，不把聊天正文传递给界面。
          if (!/"type"\s*:\s*"(?:token_usage_record|event_msg|turn_context|session_meta)"/.test(line)) continue;
          try { c.acc.feed(JSON.parse(line)); } catch { /* 写入中的半行在下一次读取时继续 */ }
        }
        await new Promise(resolve=>setImmediate(resolve));
      }
    } finally { await handle.close(); }
  }
}

function register({isEnabled=()=>true}={}) {
  const {ipcMain,app,BrowserWindow,webContents} = require('electron'), store = new RolloutStore();
  // 使用商店安装包的原始透明图标，随 Windows 任务栏主题选择黑色或白色版本。
  const {nativeTheme}=require('electron');let iconPath=null;
  const applyWindowIcon=win=>{
    if(win.isDestroyed())return;
    const dark=nativeTheme.shouldUseDarkColorsForSystemIntegratedUI??nativeTheme.shouldUseDarkColors;
    const original=path.join(__dirname,'..','assets','app-icons',`Square44x44Logo.targetsize-32_altform-${dark?'unplated':'lightunplated'}.png`);
    const file=[original,path.join(process.resourcesPath,'codex.ico'),
      path.join(os.homedir(),'AppData','Local','Programs','OpenAI','Codex','codex.ico')].find(file=>fs.existsSync(file));
    if(file){win.setIcon(file);iconPath=file;}
  };
  if(process.platform==='win32'){
    app.on('browser-window-created',(_event,win)=>{
      applyWindowIcon(win);win.once('ready-to-show',()=>applyWindowIcon(win));
    });
    app.whenReady().then(()=>BrowserWindow.getAllWindows().forEach(applyWindowIcon));
    nativeTheme.on('updated',()=>setImmediate(()=>BrowserWindow.getAllWindows().forEach(applyWindowIcon)));
  }
  ipcMain.handle(CHANNEL, async(event, request)=>{
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith('app://') && !url.startsWith('file://')) throw new Error('界面来源不受支持');
    if(!isEnabled())return {enabled:false,available:false};
    const id = request?.threadId ?? null;
    if (typeof id !== 'string' && id !== null) throw new Error('会话 ID 无效');
    return {...await store.read(id),enabled:true};
  });
  if(process.env.CODEX_USAGE_UI_PROBE_OUTPUT){
    const output=process.env.CODEX_USAGE_UI_PROBE_OUTPUT;
    app.whenReady().then(async()=>{
      try {
        const id=process.env.CODEX_USAGE_UI_PROBE_THREAD_ID;
        let navigated=!id, report=[], screenshotTarget=null,nativeOnlyApplied=false;
        const deadline=Date.now()+50000;
        while(Date.now()<deadline){
          report=[];
          for(const contents of webContents.getAllWebContents().filter(w=>!w.isDestroyed() && w.getURL().startsWith('app://'))){
            if(process.env.CODEX_USAGE_UI_PROBE_NATIVE_ONLY && !nativeOnlyApplied){
              nativeOnlyApplied=await contents.executeJavaScript(`(()=>{const roots=[...document.querySelectorAll('[data-content-search-turn-key]')];if(!roots.length)return false;for(const root of roots){root.removeAttribute('data-codex-usage-turn');root.removeAttribute('data-codex-usage-thread');root.querySelector('.cu-turn')?.remove();}return true})()`);
              if(nativeOnlyApplied)await new Promise(resolve=>setTimeout(resolve,500));
            }
            const state=await contents.executeJavaScript(`(()=>{
              const strip=document.querySelector('.cu-strip'),rect=strip?.getBoundingClientRect(),footer=strip?.closest('[data-thread-scroll-footer]');
              const geometry=(${measureMetricGeometry.toString()})(strip);
              const popup=document.querySelector('.cu-tooltip'),style=popup?getComputedStyle(popup):null;
              return {ready:document.documentElement.dataset.cuUi,rail:!!document.querySelector('[data-app-navigation-rail]'),ring:!!document.querySelector('.cu-ring'),composer:!!document.querySelector('[data-thread-find-composer]'),strip:strip?.textContent,footers:document.querySelectorAll('.cu-turn').length,turns:[...document.querySelectorAll('[data-codex-usage-turn]')].map(e=>e.getAttribute('data-codex-usage-turn')),layout:rect&&geometry?.metrics.length?{height:rect.height,...geometry,footerBottomGap:footer?footer.getBoundingClientRect().bottom-rect.bottom:null}:null,replyStats:[...document.querySelectorAll('.cu-turn')].map(e=>({text:e.textContent,inline:e.parentElement.classList.contains('turn-action-controls'),nativeActions:[...e.parentElement.children].filter(n=>n.classList.contains('opacity-0')).map(n=>({opacity:getComputedStyle(n).opacity,buttons:[...n.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),text:n.textContent})),hoverTitles:e.querySelectorAll('[title]').length,geometry:(${measureMetricGeometry.toString()})(e)})),tooltipStyle:style?{background:style.backgroundColor,radius:style.borderRadius,blur:style.backdropFilter}:null};
            })()`);
            report.push({url:contents.getURL(),...state});
            if(state.strip || !screenshotTarget && state.ring)screenshotTarget=contents;
            if(state.rail && !navigated && UUID.test(id)){
              const route='/local/'+id;
              try{
                await contents.executeJavaScript(`import('./assets/app-shared-bbfeca5e5737.js').then(m=>m.gPt.dispatchHostMessage({type:'navigate-to-route',path:${JSON.stringify(route)}}))`);
                fs.writeFileSync(output+'.navigation.json',JSON.stringify({ok:true,route}));
                navigated=true;
              }catch(e){fs.writeFileSync(output+'.navigation.json',JSON.stringify({ok:false,error:String(e)}));}
            }
          }
          if(report.some(r=>r.ring) && (!id || report.some(r=>r.composer && r.footers>0 && r.strip?.includes('tok/s'))))break;
          await new Promise(resolve=>setTimeout(resolve,2000));
        }
        if(screenshotTarget && !screenshotTarget.isDestroyed()){
          fs.writeFileSync(output+'.png',(await screenshotTarget.capturePage()).toPNG());
          if(process.env.CODEX_USAGE_UI_PROBE_ACTIONS)fs.writeFileSync(output+'.actions.json',JSON.stringify(await screenshotTarget.executeJavaScript(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return [...document.querySelectorAll('[data-codex-usage-turn]')].slice(0,2).map(root=>({children:[...root.children].map(e=>({tag:e.tagName,class:e.className,rect:rect(e)})),buttons:[...root.querySelectorAll('button')].filter(e=>/复制|朗读|更多|Copy|Read|More/i.test(e.getAttribute('aria-label')||e.title||'')).map(e=>({label:e.getAttribute('aria-label')||e.title,ancestors:[e,e.parentElement,e.parentElement?.parentElement,e.parentElement?.parentElement?.parentElement].filter(Boolean).map(n=>({tag:n.tagName,class:n.className,attributes:[...n.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]),children:[...n.children].map(c=>({tag:c.tagName,class:c.className,text:c.matches('time')?c.textContent:null})),rect:rect(n)}))}))}))})()`),null,2));
        }
        const interactionChecks=[];
        if(process.env.CODEX_USAGE_UI_PROBE_INTERACTIONS && screenshotTarget){
          for(const [kind,selector] of [['tokens','.cu-strip [data-cu-kind=tokens]'],['reply','.cu-turn [data-cu-kind=tokens]']]){
            await screenshotTarget.executeJavaScript(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b?.scrollIntoView({block:'center'});b?.click()})()`);
            await new Promise(resolve=>setTimeout(resolve,350));
            await screenshotTarget.executeJavaScript(`document.querySelector('.cu-panel')?.getAnimations().forEach(a=>a.finish())`);
            const state=await screenshotTarget.executeJavaScript(`(()=>{const p=document.querySelector('.cu-panel');return {kind:${JSON.stringify(kind)},visible:!!p&&!p.hidden&&p.dataset.state==='open',text:p?.textContent,opacity:p?getComputedStyle(p).opacity:null}})()`);
            interactionChecks.push(state);
            fs.writeFileSync(output+'.'+kind+'.png',(await screenshotTarget.capturePage()).toPNG());
          }
        }
        const nativeTurnKeys=screenshotTarget?await screenshotTarget.executeJavaScript(`({keys:[...document.querySelectorAll('[data-content-search-turn-key]')].map(e=>e.getAttribute('data-content-search-turn-key')),customHooks:document.querySelectorAll('[data-codex-usage-turn]').length,footers:[...document.querySelectorAll('.cu-turn')].map(e=>{const root=e.closest('[data-content-search-turn-key]');return {key:root?.getAttribute('data-content-search-turn-key'),enhanced:root?.hasAttribute('data-codex-usage-turn'),matchedTurn:e.querySelector('[data-cu-turn]')?.dataset.cuTurn}})})`):null;
        fs.writeFileSync(output,JSON.stringify({ok:report.some(r=>r.ring) && (!id || report.some(r=>r.composer && r.footers>0 && r.strip?.includes('tok/s'))) && interactionChecks.every(r=>r.visible&&r.opacity==='1'),windows:report,interactionChecks,nativeOnlyApplied,nativeTurnKeys,iconPath},null,2));
      }catch(e){fs.writeFileSync(output,JSON.stringify({ok:false,error:String(e)}));}
      app.exit(0);
    });
  }
}

async function selfTest() {
  const {app, BrowserWindow, ipcMain} = require('electron');
  const output = process.env.CODEX_USAGE_UI_TEST_OUTPUT;
  const write = data => fs.writeFileSync(output,JSON.stringify(data,null,2));
  try {
    await app.whenReady();
    const fixture = JSON.parse(fs.readFileSync(process.env.CODEX_USAGE_UI_FIXTURE,'utf8'));
    const snapshots=new Map([[fixture.snapshot.threadId,fixture.snapshot]]),responseDelays=new Map();
    let pluginEnabled=true;
    const pluginCode=fs.readFileSync(path.join(__dirname,'usage-preload.cjs'),'utf8');
    ipcMain.handle('codex-enhancement-loader:state-v1',()=>({enabled:pluginEnabled,key:'fixture',code:pluginCode}));
    ipcMain.handle(CHANNEL,async(_event,request)=>{
      const id=request?.threadId,delay=responseDelays.get(id)??0;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      return snapshots.get(id)??{threadId:id,available:false,limits:fixture.snapshot.limits};
    });
    const win = new BrowserWindow({width:1200,height:820,show:false,webPreferences:{preload:path.join(__dirname,'enhancement-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
    await win.loadFile(process.env.CODEX_USAGE_UI_FIXTURE_HTML);
    await new Promise(resolve=>setTimeout(resolve,2200));
    const alignmentScript=`(()=>{
      const strip=document.querySelector('.cu-strip'),rect=strip.getBoundingClientRect();
      const geometry=(${measureMetricGeometry.toString()})(strip);
      const composer=document.querySelector('.composer').getBoundingClientRect(),footer=document.querySelector('[data-thread-scroll-footer]').getBoundingClientRect();
      return {strip:strip.textContent,stripHeight:rect.height,verticalCenterOffset:geometry.metrics[0].rowCenter-(composer.bottom+footer.bottom)/2,...geometry,replyStats:[...document.querySelectorAll('.cu-turn')].map(e=>({text:e.textContent,hoverTitles:e.querySelectorAll('[title]').length+(e.hasAttribute('title')?1:0),inline:e.parentElement.classList.contains('turn-action-controls'),geometry:(${measureMetricGeometry.toString()})(e)})),composerShift:composer.bottom-window.fixtureGeometryBefore.composerBottom,footers:document.querySelectorAll('.cu-turn').length,ring:!!document.querySelector('.cu-ring'),errors:window.fixtureErrors||[],width:document.querySelector('.cu-ring')?.getBoundingClientRect().width};
    })()`;
    const report = await win.webContents.executeJavaScript(alignmentScript);
    const shot = await win.webContents.capturePage(); fs.writeFileSync(output+'.png',shot.toPNG());
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const panelState=()=>win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.cu-panel'),s=p?getComputedStyle(p):null;return {visible:!!p&&!p.hidden&&p.dataset.state==='open',text:p?.textContent,opacity:s?.opacity,transition:s?.transitionDuration,expanded:document.querySelector('.cu-metric[aria-expanded=true]')?.dataset.cuKind}})()`);
    const clickMetric=async(selector,shotName)=>{
      await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(220);
      // 隐藏测试窗口不持续推进合成帧，显式推进该浮层的过渡至终点后核对截图。
      await win.webContents.executeJavaScript(`document.querySelector('.cu-panel').getAnimations().forEach(a=>a.finish())`);
      win.webContents.invalidate?.();await delay(80);
      const state=await panelState();if(shotName)fs.writeFileSync(output+'.'+shotName+'.png',(await win.webContents.capturePage()).toPNG());return state;
    };
    const hoverPoint=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.cu-strip .cu-metric').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(hoverPoint.x),y:Math.round(hoverPoint.y)});await delay(180);
    let hoverState=await win.webContents.executeJavaScript(`({color:getComputedStyle(document.querySelector('.cu-strip .cu-metric')).backgroundColor,opened:!!document.querySelector('.cu-panel:not([hidden])'),titles:document.querySelectorAll('.cu-strip[title],.cu-turn[title],.cu-metric[title]').length,method:'mouseMove'})`);
    if(hoverState.color==='rgba(0, 0, 0, 0)'){
      // 离屏窗口没有系统鼠标命中，使用 Chromium 的伪类接口验证同一条 hover 规则。
      const debuggerApi=win.webContents.debugger;debuggerApi.attach('1.3');
      try{
        await debuggerApi.sendCommand('DOM.enable');await debuggerApi.sendCommand('CSS.enable');
        const {root}=await debuggerApi.sendCommand('DOM.getDocument');
        const {nodeId}=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'.cu-strip .cu-metric'});
        await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});await delay(180);
        await win.webContents.executeJavaScript(`document.querySelector('.cu-strip .cu-metric').getAnimations().forEach(a=>a.finish())`);
        hoverState={...hoverState,color:await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.cu-strip .cu-metric')).backgroundColor`),method:'Chromium CSS.forcePseudoState'};
        await debuggerApi.sendCommand('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
      }finally{debuggerApi.detach();}
    }
    const sessionPanel=await clickMetric('.cu-strip [data-cu-kind=session]','session');
    const tokenPanel=await clickMetric('.cu-strip [data-cu-kind=tokens]','tokens');
    const tokenState=()=>win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.cu-panel'),track=p.querySelector('.cu-token-track'),fill=track?.firstElementChild;return {font:getComputedStyle(p).fontSize,total:p.querySelector('.cu-panel-total')?.textContent,selected:p.querySelector('.cu-model-view[aria-pressed=true]')?.dataset.cuModel,segments:[...(fill?.children??[])].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e).backgroundColor,ratio:fill.getBoundingClientRect().width?e.getBoundingClientRect().width/fill.getBoundingClientRect().width:0,transition:getComputedStyle(e).transitionDuration})),legend:[...p.querySelectorAll('.cu-stat-row[data-cu-category]')].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e.querySelector('.cu-context-dot')).backgroundColor})),models:[...p.querySelectorAll('.cu-model-summary')].map(e=>e.dataset.cuModel)}})()`);
    const tokenOverview=await tokenState(),modelChoice=fixture.snapshot.models?.[0];
    await win.webContents.executeJavaScript(`window.fixtureTokenTrack=document.querySelector('.cu-token-track');[...document.querySelectorAll('.cu-model-summary')].find(e=>e.dataset.cuModel===${JSON.stringify(modelChoice?.model??'')})?.click()`);
    await delay(300);
    await win.webContents.executeJavaScript(`document.querySelector('.cu-panel').getAnimations({subtree:true}).forEach(a=>a.finish())`);
    const modelPanel=await tokenState();
    fs.writeFileSync(output+'.model.png',(await win.webContents.capturePage()).toPNG());
    await delay(1900);
    const retainedModel=await tokenState();
    const stableTokenTrack=await win.webContents.executeJavaScript(`window.fixtureTokenTrack===document.querySelector('.cu-token-track')`);
    await win.webContents.executeJavaScript(`document.querySelector('.cu-model-view[data-cu-model="*"]').click()`);await delay(300);
    const restoredOverview=await tokenState();
    const contextPanel=await clickMetric('.cu-strip [data-cu-kind=context]','context');
    const contextColors=await win.webContents.executeJavaScript(`(()=>{const track=document.querySelector('.cu-context-track'),fill=document.querySelector('.cu-context-fill');return {fillRatio:fill.getBoundingClientRect().width/track.getBoundingClientRect().width,segments:[...fill.children].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e).backgroundColor,ratio:e.getBoundingClientRect().width/fill.getBoundingClientRect().width})),legend:[...document.querySelectorAll('.cu-stat-row[data-cu-category]')].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e.querySelector('.cu-context-dot')).backgroundColor}))}})()`);
    const replyPanel=await clickMetric('.cu-turn [data-cu-kind=tokens]','reply');
    await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await delay(200);
    const escapeState=await panelState();
    await clickMetric('.cu-strip [data-cu-kind=tokens]');
    await win.webContents.executeJavaScript(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);await delay(200);
    const outsideState=await panelState();
    await win.webContents.executeJavaScript(`document.querySelector('.cu-ring').dispatchEvent(new MouseEvent('mouseenter'))`);await delay(220);
    const tooltipState=await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.cu-tooltip'),s=getComputedStyle(el);return {visible:!el.hidden,text:el.textContent,background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow,blur:s.backdropFilter}})()`);
    fs.writeFileSync(output+'.tooltip.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`window.fixtureTokenAnchor=document.querySelector('.cu-strip [data-cu-kind=tokens]');window.fixtureTokenAnchor.click()`);await delay(220);
    fixture.snapshot.total.total_tokens+=1000;fixture.snapshot.total.input_tokens+=1000;
    fixture.snapshot.turns.at(-1).completed=false;fixture.snapshot.turns.at(-1).averageTps=62.5;
    await delay(2100);
    const liveState=await win.webContents.executeJavaScript(`({...${alignmentScript},live:document.querySelector('[data-cu-live]')?.textContent,stableAnchor:window.fixtureTokenAnchor===document.querySelector('.cu-strip [data-cu-kind=tokens]')})`);
    const livePanel=await panelState();
    fixture.snapshot.turns.at(-1).completed=true;await delay(2100);
    const finishedState=await win.webContents.executeJavaScript(`({live:!!document.querySelector('[data-cu-live]'),footers:document.querySelectorAll('.cu-turn').length})`);
    pluginEnabled=false;await delay(2300);
    const disabledState=await win.webContents.executeJavaScript(`({nodes:document.querySelectorAll('.cu-strip,.cu-turn,.cu-ring,.cu-tooltip,.cu-panel').length,nativeInset:parseFloat(getComputedStyle(document.querySelector('[data-thread-scroll-footer]')).paddingBottom),adjusted:document.querySelector('[data-thread-scroll-footer]').classList.contains('cu-footer'),actions:document.querySelectorAll('.cu-action-row').length})`);
    pluginEnabled=true;await delay(2300);
    const enabledState=await win.webContents.executeJavaScript(`({ring:!!document.querySelector('.cu-ring'),footers:document.querySelectorAll('.cu-turn').length})`);
    const secondId='00000000-0000-4000-8000-000000000002',second=structuredClone(fixture.snapshot);
    second.threadId=secondId;
    const doubleUsage=u=>Object.fromEntries(Object.entries(u).map(([key,value])=>[key,value*2]));
    second.turns.forEach((turn,i)=>{
      turn.id=`22222222-2222-4222-8222-${String(i+1).padStart(12,'0')}`;turn.usage=doubleUsage(turn.usage);
      turn.models?.forEach(model=>{model.usage=doubleUsage(model.usage);});
      for(const key of ['averageTps','estimatedGenerationTps'])if(turn[key]!=null)turn[key]*=2;
    });
    second.models.forEach(model=>{model.usage=doubleUsage(model.usage);});
    second.total=Object.fromEntries(Object.keys(second.total).map(key=>[key,second.turns.reduce((n,t)=>n+t.usage[key],0)]));
    snapshots.set(secondId,second);
    await win.webContents.executeJavaScript(`(()=>{
      const first=document.querySelector('main.chat'),other=first.cloneNode(true);first.dataset.fixtureView='first';other.dataset.fixtureView='second';
      other.querySelectorAll('.cu-turn').forEach(e=>e.remove());
      [...other.querySelectorAll('[data-content-search-turn-key],[data-codex-usage-turn]')].forEach((root,i)=>{
        root.removeAttribute('data-codex-usage-turn');root.removeAttribute('data-codex-usage-thread');root.setAttribute('data-content-search-turn-key',${JSON.stringify(second.turns.map(t=>t.id))}[i]);
        const response=root.querySelector('.response'),actions=root.querySelector('.turn-action-controls'),wrapper=document.createElement('div');
        response.setAttribute('data-response-annotation-target','fixture-'+i);response.setAttribute('data-response-annotation-conversation',${JSON.stringify(secondId)});
        actions.classList.remove('actions','cu-action-row');actions.querySelectorAll('.cu-turn').forEach(e=>e.remove());response.append(wrapper);wrapper.append(actions);
      });first.after(other);other.hidden=true;
      window.fixtureNavigate=id=>{first.hidden=id!==${JSON.stringify(fixture.snapshot.threadId)};other.hidden=id!==${JSON.stringify(secondId)};document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id??'');};
      window.fixtureNavigate(${JSON.stringify(secondId)});
    })()`);
    const navigationState=()=>win.webContents.executeJavaScript(`(()=>{const active=[...document.querySelectorAll('main.chat')].find(e=>!e.hidden),strip=document.querySelector('.cu-strip'),footers=[...(active?.querySelectorAll('.cu-turn')??[])];return {strip:strip?.textContent,thread:strip?.dataset.cuThread,visibleFooters:footers.length,inline:footers.every(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return e.parentElement.classList.contains('turn-action-controls')&&Math.abs(a.y+a.height/2-b.y-b.height/2)<.5}),hiddenFooters:[...document.querySelectorAll('main.chat[hidden] .cu-turn')].length,turns:[...(active?.querySelectorAll('.cu-turn [data-cu-turn]')??[])].map(e=>e.dataset.cuTurn),panel:!!document.querySelector('.cu-panel[data-state=open]')}})()`);
    await delay(2100);const switched=await navigationState();
    fs.writeFileSync(output+'.navigation.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`(()=>{const row=document.querySelector('main[data-fixture-view=second] .turn-action-controls'),next=row.cloneNode(true);next.querySelectorAll('.cu-turn').forEach(e=>e.remove());row.replaceWith(next);})()`);
    await delay(250);const replacedActions=await navigationState();
    await win.webContents.executeJavaScript(`window.fixtureNavigate(${JSON.stringify(fixture.snapshot.threadId)})`);await delay(250);const returned=await navigationState();
    responseDelays.set(secondId,450);
    await win.webContents.executeJavaScript(`window.fixtureNavigate(${JSON.stringify(secondId)})`);await delay(80);
    const waiting=await navigationState();
    await win.webContents.executeJavaScript(`window.fixtureNavigate(${JSON.stringify(fixture.snapshot.threadId)})`);await delay(700);const rapidReturn=await navigationState();
    await win.webContents.executeJavaScript(`window.fixtureNavigate(null)`);await delay(250);const emptyThread=await navigationState();
    const checks={
      layout:!!report.strip&&report.stripHeight===46&&report.composerShift===8&&Math.abs(report.verticalCenterOffset)<.1,
      replies:report.footers===2&&report.replyStats.every(r=>!r.text.includes('≈')&&!/月|\d{2}:\d{2}/.test(r.text)&&r.hoverTitles===0&&r.inline),
      labels:!report.strip.includes('≈')&&report.errors.length===0,
      hover:hoverState.color!=='rgba(0, 0, 0, 0)'&&!hoverState.opened&&hoverState.titles===0,
      session:sessionPanel.visible&&sessionPanel.opacity==='1'&&sessionPanel.text.includes('会话统计')&&sessionPanel.text.includes('暂无数据')&&sessionPanel.transition.includes('0.16s'),
      tokens:tokenPanel.visible&&tokenPanel.text.includes('909,000 tok')&&tokenPanel.text.includes('100,000 tok')&&tokenPanel.text.includes('800,000 tok'),
      tokenColors:tokenOverview.font==='12px'&&tokenOverview.segments.length===3&&new Set(tokenOverview.segments.map(s=>s.color)).size===3&&tokenOverview.segments.every(s=>tokenOverview.legend.some(l=>l.kind===s.kind&&l.color===s.color))&&Math.abs(tokenOverview.segments.find(s=>s.kind==='cached').ratio-800000/909000)<.002,
      models:tokenOverview.models.length===2&&modelPanel.selected===modelChoice?.model&&modelPanel.total===`${modelChoice?.usage.total_tokens.toLocaleString('en-US')} tok`&&modelPanel.models.length===0&&Math.abs(modelPanel.segments.find(s=>s.kind==='cached').ratio-modelChoice.usage.cached_input_tokens/modelChoice.usage.total_tokens)<.002&&retainedModel.selected===modelPanel.selected&&stableTokenTrack&&modelPanel.segments.every(s=>s.transition.includes('0.25s'))&&restoredOverview.selected==='*'&&restoredOverview.total==='909,000 tok'&&restoredOverview.models.length===2,
      context:contextPanel.visible&&contextPanel.text.includes('上下文已用')&&contextPanel.text.includes('475,000 tok')&&contextColors.segments.length===3&&new Set(contextColors.segments.map(s=>s.color)).size===3&&contextColors.segments.every(s=>contextColors.legend.some(l=>l.kind===s.kind&&l.color===s.color))&&Math.abs(contextColors.fillRatio-46000/475000)<.001&&Math.abs(contextColors.segments.find(s=>s.kind==='cached').ratio-40000/46000)<.002,
      cleanPanels:!sessionPanel.text.includes('生成估速按已记录')&&!contextPanel.text.includes('系统提示词、工具定义'),
      replyDetails:replyPanel.visible&&replyPanel.text.includes('本轮用量')&&replyPanel.text.includes('完成时间')&&replyPanel.text.includes('404,000 tok')&&replyPanel.text.includes('350,000 tok')&&replyPanel.text.includes('50,000 tok'),
      dismissal:!escapeState.visible&&!outsideState.visible,
      quota:report.ring&&tooltipState.visible&&tooltipState.text.includes('56%')&&!/Codex 额度|外环：|来源：/.test(tooltipState.text)&&tooltipState.radius==='16px'&&tooltipState.blur==='blur(8px)',
      live:liveState.live?.includes('62.5')&&liveState.footers===1&&liveState.stableAnchor&&livePanel.visible&&livePanel.text.includes('910,000 tok')&&!finishedState.live&&finishedState.footers===2,
      lifecycle:disabledState.nodes===0&&disabledState.nativeInset===24&&!disabledState.adjusted&&disabledState.actions===0&&enabledState.ring&&enabledState.footers===2
    };
    Object.assign(checks,{
      navigation:switched.strip.includes('1.8M tok')&&switched.visibleFooters===2&&switched.inline&&switched.hiddenFooters===0&&switched.turns.every(id=>second.turns.some(t=>t.id===id)),
      replacedActions:replacedActions.visibleFooters===2&&replacedActions.inline&&replacedActions.hiddenFooters===0,
      returnNavigation:returned.strip.includes('910K tok')&&returned.visibleFooters===2&&returned.hiddenFooters===0,
      rapidNavigation:!waiting.strip.includes('910K tok')&&rapidReturn.strip.includes('910K tok')&&rapidReturn.visibleFooters===2&&rapidReturn.hiddenFooters===0,
      emptyThread:!emptyThread.strip.includes('tok')&&emptyThread.visibleFooters===0&&emptyThread.hiddenFooters===0
    });
    write({ok:Object.values(checks).every(Boolean),checks,version:app.getVersion(),runtime:process.versions,...report,hoverState,sessionPanel,tokenPanel,tokenOverview,modelPanel,retainedModel,restoredOverview,stableTokenTrack,contextPanel,contextColors,replyPanel,escapeState,outsideState,tooltipState,liveState,livePanel,finishedState,disabledState,enabledState,navigation:{switched,replacedActions,returned,waiting,rapidReturn,emptyThread}});
    win.destroy(); app.exit(0);
  } catch (e) { write({ok:false,error:String(e),stack:e.stack}); app.exit(1); }
}
module.exports = {RolloutStore,register,selfTest};
