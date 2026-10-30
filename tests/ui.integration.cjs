'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {READ_CHANNEL:CHANNEL}=require('../src/protocol.cjs');

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

async function selfTest() {
  const {app, BrowserWindow, ipcMain} = require('electron');
  const output = process.env.CODEX_USAGE_UI_TEST_OUTPUT;
  const write = data => fs.writeFileSync(output,JSON.stringify(data,null,2));
  try {
    await app.whenReady();
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'fixture.json'),'utf8'));
    const snapshots=new Map([[fixture.snapshot.threadId,fixture.snapshot]]),responseDelays=new Map();
    let pluginEnabled=true;
    const pluginCode=fs.readFileSync(path.join(__dirname,'../dist/usage-preload.cjs'),'utf8');
    ipcMain.handle('codex-enhancement-loader:state-v1',()=>({enabled:pluginEnabled,key:'fixture',code:pluginCode}));
    ipcMain.handle(CHANNEL,async(_event,request)=>{
      const id=request?.threadId,delay=responseDelays.get(id)??0;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      return snapshots.get(id)??{threadId:id,available:false,limits:fixture.snapshot.limits};
    });
    const win = new BrowserWindow({width:1200,height:820,show:false,webPreferences:{preload:path.join(__dirname,'../dist/enhancement-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
    await win.loadFile(path.join(__dirname,'fixture.html'));
    await new Promise(resolve=>setTimeout(resolve,2200));
    const alignmentScript=`(()=>{
      const strip=document.querySelector('.cu-strip'),rect=strip.getBoundingClientRect();
      const geometry=(${measureMetricGeometry.toString()})(strip);
      const composer=document.querySelector('.composer').getBoundingClientRect(),footer=document.querySelector('[data-thread-scroll-footer]').getBoundingClientRect();
      return {strip:strip.textContent,stripHeight:rect.height,verticalCenterOffset:geometry.metrics[0].rowCenter-(composer.bottom+footer.bottom)/2,...geometry,replyStats:[...document.querySelectorAll('.cu-turn')].map(e=>({text:e.textContent,hoverTitles:e.querySelectorAll('[title]').length+(e.hasAttribute('title')?1:0),inline:e.parentElement.classList.contains('turn-action-controls'),nativeControls:[...e.parentElement.querySelectorAll(':scope>.opacity-0')].map(n=>getComputedStyle(n).opacity),geometry:(${measureMetricGeometry.toString()})(e)})),composerShift:composer.bottom-window.fixtureGeometryBefore.composerBottom,footers:document.querySelectorAll('.cu-turn').length,ring:!!document.querySelector('.cu-ring'),errors:window.fixtureErrors||[],width:document.querySelector('.cu-ring')?.getBoundingClientRect().width};
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
    const originalTokens={total:fixture.snapshot.total,models:fixture.snapshot.models,cacheHitPercent:fixture.snapshot.cacheHitPercent};
    const totalOnly={input_tokens:0,cached_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:68597};
    fixture.snapshot.total={...totalOnly};fixture.snapshot.models=[{model:null,usage:{...totalOnly},cacheHitPercent:null}];fixture.snapshot.cacheHitPercent=null;
    await delay(2100);const tokenUnclassified=await tokenState();
    Object.assign(fixture.snapshot,originalTokens);await delay(2100);const tokenClassifiedAgain=await tokenState();
    const contextPanel=await clickMetric('.cu-strip [data-cu-kind=context]','context');
    const contextColors=await win.webContents.executeJavaScript(`(()=>{const track=document.querySelector('.cu-context-track'),fill=document.querySelector('.cu-context-fill');return {fillRatio:fill.getBoundingClientRect().width/track.getBoundingClientRect().width,segments:[...fill.children].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e).backgroundColor,ratio:e.getBoundingClientRect().width/fill.getBoundingClientRect().width})),legend:[...document.querySelectorAll('.cu-stat-row[data-cu-category]')].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e.querySelector('.cu-context-dot')).backgroundColor}))}})()`);
    const originalContext={lastUsage:fixture.snapshot.lastUsage,contextWindow:fixture.snapshot.contextWindow,contextPercent:fixture.snapshot.contextPercent};
    const contextState=()=>win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.cu-panel'),track=p.querySelector('.cu-context-track'),fill=track.firstElementChild;return {text:p.textContent,fillRatio:fill.getBoundingClientRect().width/track.getBoundingClientRect().width,segments:[...fill.children].map(e=>({kind:e.dataset.cuCategory,color:getComputedStyle(e).backgroundColor,ratio:e.getBoundingClientRect().width/fill.getBoundingClientRect().width})),rows:[...p.querySelectorAll('.cu-stat-row[data-cu-category]')].map(e=>({kind:e.dataset.cuCategory,value:e.lastElementChild.textContent,color:getComputedStyle(e.querySelector('.cu-context-dot')).backgroundColor}))}})()`);
    fixture.snapshot.lastUsage={...totalOnly};fixture.snapshot.contextWindow=258400;fixture.snapshot.contextPercent=68597/258400*100;
    await delay(2100);const contextUnclassified=await contextState();
    fs.writeFileSync(output+'.context-unclassified.png',(await win.webContents.capturePage()).toPNG());
    fixture.snapshot.lastUsage={...totalOnly,input_tokens:100,cached_input_tokens:80,total_tokens:150};fixture.snapshot.contextWindow=1000;fixture.snapshot.contextPercent=15;
    await delay(2100);const contextPartial=await contextState();
    Object.assign(fixture.snapshot,originalContext);await delay(2100);const contextClassifiedAgain=await contextState();
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
      [...other.querySelectorAll('[data-content-search-turn-key]')].forEach((root,i)=>{
        root.setAttribute('data-content-search-turn-key',${JSON.stringify(second.turns.map(t=>t.id))}[i]);
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
    await win.webContents.executeJavaScript(`window.fixtureNavigate(${JSON.stringify(fixture.snapshot.threadId)})`);await delay(250);
    await win.webContents.executeJavaScript(`(()=>{
      const root=document.querySelector('[data-thread-find-composer]'),strip=root.querySelector('.cu-strip'),form=document.createElement('form');
      form.setAttribute('data-thread-find-composer','true');root.insertBefore(form,strip);
      for(const child of [...root.childNodes])if(child!==strip&&child!==form)form.append(child);
      const decoy=document.createElement('button');decoy.type='button';decoy.textContent='确认';
      decoy.setAttribute('data-thread-find-composer','');document.body.append(decoy);decoy.focus();
      const blank=document.createElement('span');blank.setAttribute('data-above-composer-conversation-id','');form.append(blank);
    })()`);
    await delay(300);
    const adapterState=()=>win.webContents.executeJavaScript(`(()=>{
      const strip=document.querySelector('.cu-strip'),footer=strip?.closest('[data-thread-scroll-footer]');
      return {strips:document.querySelectorAll('.cu-strip').length,thread:strip?.dataset.cuThread,
        outsideForm:strip?.parentElement.classList.contains('composer-area')&&strip?.closest('form')==null,
        footer:footer?.dataset.fixtureFooter,hiddenStrips:document.querySelectorAll('[data-thread-scroll-footer][hidden] .cu-strip').length,
        replies:[...document.querySelectorAll('main[data-fixture-view=first] .cu-turn')].map(node=>({inline:node.parentElement.classList.contains('turn-action-controls'),sibling:node.parentElement.dataset.fixtureSibling==='true'})),text:strip?.textContent};
    })()`);
    const nestedComposer=await adapterState();
    await win.webContents.executeJavaScript(`(()=>{
      const root=document.querySelector('main[data-fixture-view=first] [data-content-search-turn-key]'),response=root.querySelector('[data-response-annotation-conversation]');
      const actions=response.querySelector('.turn-action-controls');actions.dataset.fixtureSibling='true';root.append(actions);
      const userActions=document.createElement('div');userActions.className='turn-action-controls';root.prepend(userActions);
    })()`);await delay(250);
    const siblingActions=await adapterState();
    fs.writeFileSync(output+'.adaptation.png',(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`(()=>{
      const old=document.querySelector('[data-thread-scroll-footer]'),next=old.cloneNode(true);
      next.querySelectorAll('.cu-strip').forEach(node=>node.remove());next.dataset.fixtureFooter='replacement';
      old.hidden=true;old.after(next);
    })()`);await delay(300);
    const replacedComposer=await adapterState();
    await win.webContents.executeJavaScript(`document.querySelector('[data-fixture-footer=replacement]').querySelectorAll('[data-above-composer-conversation-id]').forEach(node=>node.remove())`);
    await delay(250);const missingPortal=await adapterState();
    const checks={
      layout:!!report.strip&&report.stripHeight===46&&report.composerShift===8&&Math.abs(report.verticalCenterOffset)<.1,
      replies:report.footers===2&&report.replyStats.every(r=>!r.text.includes('≈')&&!/月|\d{2}:\d{2}/.test(r.text)&&r.hoverTitles===0&&r.inline),
      nativeActions:report.replyStats.every(r=>r.nativeControls.length===4&&r.nativeControls.every(opacity=>opacity==='1')),
      labels:!report.strip.includes('≈')&&report.errors.length===0,
      hover:hoverState.color!=='rgba(0, 0, 0, 0)'&&!hoverState.opened&&hoverState.titles===0,
      session:sessionPanel.visible&&sessionPanel.opacity==='1'&&sessionPanel.text.includes('会话统计')&&sessionPanel.text.includes('暂无数据')&&sessionPanel.transition.includes('0.16s'),
      tokens:tokenPanel.visible&&tokenPanel.text.includes('909,000 tok')&&tokenPanel.text.includes('100,000 tok')&&tokenPanel.text.includes('800,000 tok'),
      tokenColors:tokenOverview.font==='12px'&&tokenOverview.segments.length===3&&new Set(tokenOverview.segments.map(s=>s.color)).size===3&&tokenOverview.segments.every(s=>tokenOverview.legend.some(l=>l.kind===s.kind&&l.color===s.color))&&Math.abs(tokenOverview.segments.find(s=>s.kind==='cached').ratio-800000/909000)<.002,
      models:tokenOverview.models.length===2&&modelPanel.selected===modelChoice?.model&&modelPanel.total===`${modelChoice?.usage.total_tokens.toLocaleString('en-US')} tok`&&modelPanel.models.length===0&&Math.abs(modelPanel.segments.find(s=>s.kind==='cached').ratio-modelChoice.usage.cached_input_tokens/modelChoice.usage.total_tokens)<.002&&retainedModel.selected===modelPanel.selected&&stableTokenTrack&&modelPanel.segments.every(s=>s.transition.includes('0.25s'))&&restoredOverview.selected==='*'&&restoredOverview.total==='909,000 tok'&&restoredOverview.models.length===2,
      tokenUnclassified:tokenUnclassified.total==='68,597 tok'&&tokenUnclassified.segments.length===4&&tokenUnclassified.segments.some(s=>s.kind==='unknown'&&Math.abs(s.ratio-1)<.002)&&tokenClassifiedAgain.total==='909,000 tok'&&tokenClassifiedAgain.segments.length===3,
      context:contextPanel.visible&&contextPanel.text.includes('上下文已用')&&contextPanel.text.includes('475,000 tok')&&contextColors.segments.length===3&&new Set(contextColors.segments.map(s=>s.color)).size===3&&contextColors.segments.every(s=>contextColors.legend.some(l=>l.kind===s.kind&&l.color===s.color))&&Math.abs(contextColors.fillRatio-46000/475000)<.001&&Math.abs(contextColors.segments.find(s=>s.kind==='cached').ratio-40000/46000)<.002,
      contextUnclassified:contextUnclassified.text.includes('27%')&&contextUnclassified.text.includes('68,597 tok')&&contextUnclassified.rows.filter(r=>r.kind!=='unknown').every(r=>r.value==='—')&&contextUnclassified.segments.some(s=>s.kind==='unknown'&&Math.abs(s.ratio-1)<.002&&contextUnclassified.rows.some(r=>r.kind==='unknown'&&r.color===s.color))&&Math.abs(contextUnclassified.fillRatio-68597/258400)<.001,
      contextPartial:contextPartial.rows.some(r=>r.kind==='unknown'&&r.value==='50 tok')&&contextPartial.rows.some(r=>r.kind==='cached'&&r.value==='80 tok')&&contextPartial.rows.some(r=>r.kind==='uncached'&&r.value==='20 tok')&&Math.abs(contextPartial.segments.find(s=>s.kind==='unknown').ratio-1/3)<.002&&Math.abs(contextPartial.fillRatio-.15)<.001,
      contextClassifiedAgain:contextClassifiedAgain.segments.length===3&&!contextClassifiedAgain.rows.some(r=>r.kind==='unknown')&&Math.abs(contextClassifiedAgain.fillRatio-46000/475000)<.001,
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
    Object.assign(checks,{
      nestedComposer:nestedComposer.strips===1&&nestedComposer.outsideForm&&nestedComposer.thread===fixture.snapshot.threadId&&nestedComposer.replies.length===2,
      siblingActions:siblingActions.replies.length===2&&siblingActions.replies.every(reply=>reply.inline)&&siblingActions.replies[0].sibling,
      replacedComposer:replacedComposer.strips===1&&replacedComposer.outsideForm&&replacedComposer.footer==='replacement'&&replacedComposer.hiddenStrips===0&&replacedComposer.thread===fixture.snapshot.threadId,
      missingPortal:missingPortal.thread===''&&!missingPortal.text.includes('tok')&&missingPortal.replies.length===0
    });
    write({ok:Object.values(checks).every(Boolean),checks,version:app.getVersion(),runtime:process.versions,...report,hoverState,sessionPanel,tokenPanel,tokenOverview,modelPanel,retainedModel,restoredOverview,stableTokenTrack,tokenUnclassified,tokenClassifiedAgain,contextPanel,contextColors,contextUnclassified,contextPartial,contextClassifiedAgain,replyPanel,escapeState,outsideState,tooltipState,liveState,livePanel,finishedState,disabledState,enabledState,navigation:{switched,replacedActions,returned,waiting,rapidReturn,emptyThread},adaptation:{nestedComposer,siblingActions,replacedComposer,missingPortal}});
    win.destroy(); app.exit(0);
  } catch (e) { write({ok:false,error:String(e),stack:e.stack}); app.exit(1); }
}

selfTest();
