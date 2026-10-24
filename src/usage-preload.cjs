'use strict';

(() => {
  window.__codexUsagePluginDispose?.();
  const {ipcRenderer} = require('electron');
  const CHANNEL = 'codex-usage-ui:read-v1';
  let snapshot = null, currentId = null, busy = false, pending = false, timer = null;
  let strip = null, ring = null, tooltip = null, ringButton = null;
  let metricPanel=null,panelAnchor=null,panelCloseTimer=null,quotaHideTimer=null,quotaCloseTimer=null;
  const byId = new Map();
  const adjustedFooters = new Set();
  const adjustedActionRows = new Set();
  const textMeasure = document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  let activeObserver=null,activePoll=null,stopped=false;
  window.__codexUsagePluginDispose=()=>{
    stopped=true;activeObserver?.disconnect();clearInterval(activePoll);clearTimeout(timer);
    clearTimeout(panelCloseTimer);clearTimeout(quotaHideTimer);clearTimeout(quotaCloseTimer);
    window.removeEventListener('resize',onResize);
    document.removeEventListener('pointerdown',onOutsidePointer,true);
    document.removeEventListener('keydown',onPanelKeydown,true);
    document.removeEventListener('scroll',positionMetricPanel,true);
    for(const footer of adjustedFooters){footer.classList.remove('cu-footer');footer.style.removeProperty('--cu-strip-height');}
    for(const row of adjustedActionRows)row.classList.remove('cu-action-row');
    document.querySelectorAll('.cu-strip,.cu-turn,.cu-ring,.cu-tooltip,.cu-panel,#codex-usage-ui-style').forEach(e=>e.remove());
    if(document.documentElement)delete document.documentElement.dataset.cuUi;
    window.__codexUsagePluginDispose=null;
  };
  const fmt = n => n == null || !Number.isFinite(n) ? '—' : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n/1e3)}K` : Math.round(n).toLocaleString('en-US');
  const pct = n => n == null ? '—' : `${Math.round(n)}%`;
  function countdown(ms) {
    if (ms == null || !Number.isFinite(ms)) return '重置时间不可用';
    if (ms <= 0) return '等待刷新';
    const m = Math.ceil(ms/60000), d = Math.floor(m/1440), h = Math.floor(m%1440/60);
    return d ? `${d}天 ${h}小时` : h ? `${h}小时 ${m%60}分` : `${m}分`;
  }
  function shortTime(ms) {
    if (ms == null) return '—'; if (ms <= 0) return '待刷新';
    return ms >= 86400000 ? `${Math.ceil(ms/86400000)}天` : ms >= 3600000 ? `${Math.ceil(ms/3600000)}时` : `${Math.ceil(ms/60000)}分`;
  }
  const elapsed = ms => ms == null ? '—' : ms >= 60000 ? `${(ms/60000).toFixed(1)} 分钟` : `${(ms/1000).toFixed(1)} 秒`;
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function element(tag, className, text) {
    const el = document.createElement(tag); if (className) el.className = className;
    if (text != null) el.textContent = text; return el;
  }
  function visible(el) { return el && el.getClientRects().length > 0 && el.closest('[aria-hidden="true"]') == null; }
  function getThreadId() {
    const m = `${location.pathname}${location.hash}`.match(/\/(?:local|threads|thread)\/([0-9a-f-]{36})(?:[/?#]|$)/i);
    if (m) return m[1];
    const portals = [...document.querySelectorAll('[data-above-composer-conversation-id]')];
    const portal = portals.find(visible);
    return portal?.getAttribute('data-above-composer-conversation-id') ?? document.querySelector('[data-codex-usage-thread]')?.getAttribute('data-codex-usage-thread') ?? null;
  }
  function injectStyle() {
    if (document.getElementById('codex-usage-ui-style')) return;
    const style = element('style'); style.id = 'codex-usage-ui-style';
    style.textContent = `
      .cu-strip,.cu-turn{font-family:var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-size:var(--text-sm,12px);font-weight:400;line-height:20px;color:var(--color-text-secondary,var(--app-color-text-secondary,#979b9f));font-variant-numeric:tabular-nums;user-select:none}
      .cu-footer:has(.cu-strip){padding-bottom:0!important}
      .cu-strip{display:flex;align-items:center;align-content:center;justify-content:center;gap:0 8px;flex-wrap:wrap;min-height:var(--cu-strip-height,30px);padding:0 6px;margin:0;flex-shrink:0}
      .cu-strip>.cu-metric,.cu-turn>.cu-metric{display:flex;align-items:center;gap:5px;box-sizing:border-box;height:calc(var(--spacing,4px)*6);margin:0;padding:0 6px;white-space:nowrap;font:inherit;line-height:20px;border:0;border-radius:var(--radius-md,6px);color:inherit;background:transparent;cursor:pointer;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out),color .15s var(--ease-out,ease-out)}
      .cu-metric:hover,.cu-metric[aria-expanded=true]{background:var(--color-background-primary-ghost-hover,#ffffff12);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}.cu-metric:focus-visible{outline:2px solid var(--color-ring,#79acfe)}
      .cu-metric>.cu-metric-label{display:block;margin:0;padding:0;border:0;font:inherit;font-weight:400;line-height:20px;letter-spacing:normal}
      .cu-strip svg,.cu-turn svg,.cu-panel svg{display:block;width:14px;height:14px;overflow:visible;stroke:currentColor;fill:none;stroke-width:1.5;flex-shrink:0}
      .cu-turn{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:5px 0 12px;min-width:0;clear:both}
      .cu-turn-inline{padding:0;margin-inline-start:6px;clear:none}.cu-action-row{column-gap:2px}
      .cu-action-row>.opacity-0{opacity:1!important}
      .cu-turn>span{white-space:nowrap}.cu-turn [data-cu-usage]{display:inline-flex;align-items:center;gap:4px}
      .cu-ring{width:36px;height:36px;min-height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;align-self:center;margin:2px 0;position:relative}
      .cu-ring button{border:0;padding:2px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:inherit;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out)}
      .cu-ring button:hover,.cu-ring button:focus-visible{background:var(--color-background-primary-ghost-hover,#ffffff12)}
      .cu-ring svg{width:32px;height:32px;overflow:visible}.cu-ring circle{fill:none;stroke-width:3;transform:rotate(-90deg);transform-origin:center;stroke-linecap:round;transition:stroke-dashoffset .35s var(--ease-out,ease-out),stroke .2s}
      .cu-ring .cu-track{stroke:currentColor;opacity:.12}.cu-ring text{fill:var(--color-text-secondary,var(--app-color-text-secondary,#a5abb3));font:6.5px "Segoe UI",sans-serif;text-anchor:middle;dominant-baseline:central}
      .cu-tooltip,.cu-panel{position:fixed;z-index:2147483647;box-sizing:border-box;min-width:min(280px,calc(100vw - 24px));max-width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px;border-radius:var(--radius-2xl,16px);background:color-mix(in srgb,var(--color-surface-elevated-secondary,#262626) 90%,transparent);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8));box-shadow:0 0 0 var(--dropdown-overlay-ring-width,.5px) var(--color-border-overlay,#ffffff26),var(--shadow-dropdown-overlay,0 8px 32px #0005);backdrop-filter:blur(var(--blur-sm,8px));border:0;font:400 var(--text-base,14px)/20px var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-variant-numeric:tabular-nums;user-select:text;opacity:0;transform:translateY(4px) scale(.98);transform-origin:bottom center;transition:opacity .16s var(--ease-out,ease-out),transform .16s var(--ease-out,ease-out)}
      .cu-tooltip[data-state=open],.cu-panel[data-state=open]{opacity:1;transform:none}.cu-tooltip[hidden],.cu-panel[hidden]{display:none}.cu-tooltip[data-state=closed],.cu-panel[data-state=closed]{pointer-events:none}
      .cu-tooltip strong,.cu-panel strong{font:inherit;font-weight:600}.cu-tooltip p{margin:8px 0 0}.cu-muted,.cu-note{color:var(--color-text-secondary,#999)}.cu-tooltip .cu-muted,.cu-note{font-size:var(--text-sm,12px)}.cu-tooltip .cu-quota-detail+.cu-quota-detail{border-top:1px solid var(--color-border-overlay,#ffffff26);margin-top:12px;padding-top:12px}
      .cu-panel-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:12px;margin-bottom:10px;border-bottom:1px solid var(--color-border-overlay,#ffffff26)}.cu-panel-heading{display:flex;align-items:center;gap:8px}.cu-panel-total{white-space:nowrap}.cu-stat-row{display:flex;align-items:baseline;justify-content:space-between;gap:24px;padding:4px 0}.cu-stat-label{color:var(--color-text-secondary,#999)}.cu-stat-value{text-align:right;overflow-wrap:anywhere}.cu-note{margin:10px 0 0;line-height:18px}.cu-context-track{height:5px;border-radius:99px;background:var(--color-background-primary-ghost-hover,#ffffff12);overflow:hidden;margin:4px 0 12px}.cu-context-fill{display:flex;height:100%;border-radius:inherit;overflow:hidden;transition:width .25s var(--ease-out,ease-out)}
      .cu-context-segment{display:block;flex:0 0 auto;height:100%;background:var(--cu-context-color);transition:width .25s var(--ease-out,ease-out)}.cu-context-uncached{--cu-context-color:var(--purple-400,#a78bfa)}.cu-context-cached{--cu-context-color:var(--blue-400,#60a5fa)}.cu-context-output{--cu-context-color:var(--green-400,#4ade80)}.cu-stat-row[data-cu-category]>.cu-stat-label{display:inline-flex;align-items:center;gap:8px}.cu-context-dot{display:inline-block;flex-shrink:0;width:8px;height:8px;border-radius:2px;background:var(--cu-context-color)}
      @media(max-width:620px){.cu-strip{gap:2px 4px}.cu-turn{gap:2px}}
      @media(prefers-reduced-motion:reduce){.cu-metric,.cu-ring button,.cu-ring circle,.cu-tooltip,.cu-panel,.cu-context-fill,.cu-context-segment{transition:none}}
    `;
    (document.head ?? document.documentElement).append(style);
  }
  const icons = {
    speed:'<path d="M3 12a8 8 0 1 1 14 0M10 10l4-4"/><circle cx="10" cy="10" r="1"/>',
    token:'<ellipse cx="10" cy="4" rx="6" ry="2.5"/><path d="M4 4v10c0 3 12 3 12 0V4M4 8c0 3 12 3 12 0M4 12c0 3 12 3 12 0"/>',
    context:'<circle cx="10" cy="10" r="7" opacity=".35"/><path d="M10 3a7 7 0 0 1 7 7"/>'
  };
  function iconSvg(icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('aria-hidden','true');svg.innerHTML=icons[icon];return svg;
  }
  function metric(icon, text, kind, turnId) {
    const el = element('button','cu-metric');el.type='button';
    el.dataset.cuKind=kind;el.dataset.cuTurn=turnId??'';
    el.setAttribute('aria-haspopup','dialog');el.setAttribute('aria-expanded','false');el.setAttribute('aria-controls','cu-metric-popover');
    el.addEventListener('click',()=>toggleMetricPanel(el));
    if (icon) el.append(iconSvg(icon));
    el.append(element('span','cu-metric-label',text));return el;
  }
  function updateMetrics(container, items) {
    let changed=false;
    for(const child of [...container.childNodes])if(child.nodeType===3){child.remove();changed=true;}
    const old=new Map([...container.children].map(e=>[e.dataset.cuKey,e]));
    items.forEach((item,index)=>{
      let button=old.get(item.key);old.delete(item.key);
      if(!button){button=metric(item.icon,item.text,item.kind,item.turnId);button.dataset.cuKey=item.key;changed=true;}
      const label=button.querySelector('.cu-metric-label');
      if(label.textContent!==item.text){setText(label,item.text);changed=true;}
      button.setAttribute('aria-label',`${item.text}，点击查看详情`);
      button.toggleAttribute('data-cu-live',item.live===true);
      if(container.children[index]!==button){container.insertBefore(button,container.children[index]??null);changed=true;}
    });
    for(const button of old.values()){if(button===panelAnchor)closeMetricPanel();button.remove();changed=true;}
    if(changed)alignMetrics(container);
  }
  function alignMetrics(container) {
    if(!container || !textMeasure)return;
    for(const label of container.querySelectorAll('.cu-metric-label')){
      const row=label.parentElement,svg=row.querySelector('svg');
      label.style.removeProperty('transform');svg?.style.removeProperty('transform');
      const bounds=row.getBoundingClientRect(),target=bounds.top+bounds.height/2;
      const style=getComputedStyle(label);
      const scale=label.getBoundingClientRect().height/(parseFloat(style.height)||20);
      textMeasure.font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
      const text=label.textContent,font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
      const width=textMeasure.measureText(text).width;
      const marker=element('span');marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0';
      label.append(marker);const baseline=marker.getBoundingClientRect().top;marker.remove();
      // 以当前缩放栅格化字形，保留基线的像素相位，避免字体回退和 hinting 造成高低差。
      const dpr=devicePixelRatio||1,pixelScale=dpr*scale,size=parseFloat(style.fontSize);
      textMeasure.canvas.width=Math.max(1,Math.ceil((width+8)*pixelScale));
      textMeasure.canvas.height=Math.ceil((size*4+8)*pixelScale);
      const reference=Math.ceil(size*2*pixelScale)+(baseline*dpr%1);
      textMeasure.setTransform(pixelScale,0,0,pixelScale,0,0);textMeasure.font=font;textMeasure.fillStyle='#fff';
      textMeasure.fillText(text,4,reference/pixelScale);
      const pixels=textMeasure.getImageData(0,0,textMeasure.canvas.width,textMeasure.canvas.height);
      let top=pixels.height,bottom=-1;
      for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++)if(pixels.data[(y*pixels.width+x)*4+3]>24){top=Math.min(top,y);bottom=Math.max(bottom,y);break;}
      const center=bottom<0?target:baseline+((top+bottom+1)/2-reference)/dpr;
      const shift=Math.round((target-center)*dpr)/dpr;
      label.style.transform=`translateY(${shift/scale}px)`;
      const glyphCenter=center+shift;
      if(svg){
        const box=svg.getBBox(),matrix=svg.getScreenCTM();
        const iconCenter=matrix.b*(box.x+box.width/2)+matrix.d*(box.y+box.height/2)+matrix.f;
        svg.style.transform=`translateY(${(glyphCenter-iconCenter)/scale}px)`;
      }
    }
  }
  function alignRenderedMetrics() {
    alignMetrics(strip);
    document.querySelectorAll('.cu-turn').forEach(alignMetrics);
  }
  function speedLabel(turn) {
    return turn?.estimatedGenerationTps != null ? `${Math.round(turn.estimatedGenerationTps)} tok/s` : turn?.averageTps != null ? `整轮 ${turn.averageTps.toFixed(1)} tok/s` : '速度 —';
  }
  const tokens=n=>n==null?'暂无数据':`${Math.round(n).toLocaleString('en-US')} tok`;
  const completedDate=turn=>turn?.completedAt?new Date(turn.completedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):null;
  function statRow(label,value) {
    const row=element('div','cu-stat-row');row.append(element('span','cu-stat-label',label),element('span','cu-stat-value',value??'暂无数据'));return row;
  }
  function panelHeader(title,icon,total) {
    const header=element('div','cu-panel-header'),heading=element('strong','cu-panel-heading');
    if(icon)heading.append(iconSvg(icon));heading.append(element('span','',title));header.append(heading);
    if(total)header.append(element('strong','cu-panel-total',total));return header;
  }
  function buildMetricDetails(anchor) {
    const kind=anchor.dataset.cuKind,id=anchor.dataset.cuTurn;
    const turn=id?byId.get(id):null,last=snapshot?.turns?.at(-1);
    const u=turn?.usage??snapshot?.total;
    const nodes=[];
    if(!snapshot?.available)return [element('p','cu-note','暂无可用统计数据')];
    if(kind==='tokens'){
      nodes.push(panelHeader(turn?'本轮用量':'Token 用量','token',tokens(u?.total_tokens)),
        statRow('缓存命中',pct(turn?turn.cacheHitPercent:snapshot.cacheHitPercent)),
        statRow('未缓存输入',tokens(u?Math.max(0,u.input_tokens-u.cached_input_tokens):null)),
        statRow('缓存读取',tokens(u?.cached_input_tokens)),statRow('输入合计',tokens(u?.input_tokens)),statRow('输出（含推理）',tokens(u?.output_tokens)));
      if(snapshot.model && !turn)nodes.push(statRow('当前模型',snapshot.model));
    }else if(kind==='context'){
      const usage=snapshot.lastUsage;
      // 缓存属于输入的一部分，三种颜色按互不重叠的计数绘制。
      const cached=usage?Math.min(usage.input_tokens,usage.cached_input_tokens):null;
      const parts=[
        {key:'uncached',label:'未缓存输入',amount:usage?usage.input_tokens-cached:null},
        {key:'cached',label:'缓存输入',amount:cached},
        {key:'output',label:'输出（含推理）',amount:usage?.output_tokens}
      ];
      const total=parts.reduce((sum,p)=>sum+(p.amount??0),0);
      nodes.push(panelHeader(`上下文已用 ${pct(snapshot.contextPercent)}`,'context',`${fmt(usage?.total_tokens)} / ${fmt(snapshot.contextWindow)}`));
      if(snapshot.contextPercent!=null){
        const track=element('div','cu-context-track'),fill=element('div','cu-context-fill');
        track.role='progressbar';track.setAttribute('aria-label','上下文占用');track.setAttribute('aria-valuenow',String(Math.round(snapshot.contextPercent)));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
        fill.style.width=`${Math.min(100,Math.max(0,snapshot.contextPercent))}%`;
        for(const part of parts){
          const segment=element('span',`cu-context-segment cu-context-${part.key}`);
          segment.dataset.cuCategory=part.key;segment.style.width=`${total>0?(part.amount??0)/total*100:0}%`;segment.setAttribute('aria-hidden','true');fill.append(segment);
        }
        track.setAttribute('aria-valuetext',parts.map(p=>`${p.label} ${tokens(p.amount)}`).join('，'));track.append(fill);nodes.push(track);
      }
      for(const part of parts){
        const row=statRow(part.label,tokens(part.amount));row.dataset.cuCategory=part.key;row.classList.add(`cu-context-${part.key}`);
        const dot=element('span','cu-context-dot');dot.setAttribute('aria-hidden','true');row.firstElementChild.prepend(dot);nodes.push(row);
      }
      nodes.push(statRow('模型窗口',tokens(snapshot.contextWindow)));
    }else{
      const active=kind==='live'?last:turn,turns=active?[active]:snapshot.turns??[];
      const generated=turns.reduce((n,t)=>n+(t.generatedMs??0),0),duration=turns.reduce((n,t)=>n+(t.durationMs??0),0);
      const firstTokens=turns.map(t=>t.timeToFirstTokenMs).filter(n=>n!=null);
      const latest=active??last;
      nodes.push(panelHeader(kind==='live'?'当前执行':turn?'本轮统计':'会话统计','speed'),
        statRow(active?'状态':'对话轮数',active?active.status:`${snapshot.turnCount} 轮`),
        statRow('模型请求',`${turns.reduce((n,t)=>n+t.requests,0)} 次`),
        statRow('模型生成区间',generated?elapsed(generated):null),statRow('整轮耗时',duration?elapsed(duration):null),
        statRow('工具调用',`${turns.reduce((n,t)=>n+t.tools,0)} 次`),
        statRow('首 token 平均（TTFT）',firstTokens.length?elapsed(firstTokens.reduce((a,b)=>a+b,0)/firstTokens.length):null),
        statRow(kind==='live'?'当前整轮平均':'生成速度（估算）',kind==='live'?`${latest?.averageTps?.toFixed(1)??'—'} tok/s`:speedLabel(latest)));
    }
    if(completedDate(turn))nodes.push(statRow('完成时间',completedDate(turn)));
    return nodes;
  }
  function renderMetricPanel() {
    if(!metricPanel || metricPanel.hidden || !panelAnchor)return;
    if(!panelAnchor.isConnected){closeMetricPanel();return;}
    const nodes=buildMetricDetails(panelAnchor),signature=nodes.map(n=>n.textContent).join('|');
    if(metricPanel.dataset.content!==signature){metricPanel.replaceChildren(...nodes);metricPanel.dataset.content=signature;}
    positionMetricPanel();
  }
  function toggleMetricPanel(anchor) {
    if(panelAnchor===anchor && metricPanel?.dataset.state==='open'){closeMetricPanel();return;}
    panelAnchor?.setAttribute('aria-expanded','false');panelAnchor=anchor;anchor.setAttribute('aria-expanded','true');
    clearTimeout(panelCloseTimer);
    if(!metricPanel){metricPanel=element('div','cu-panel');metricPanel.id='cu-metric-popover';metricPanel.role='dialog';metricPanel.tabIndex=-1;document.body.append(metricPanel);}
    metricPanel.setAttribute('aria-label',anchor.dataset.cuKind==='context'?'上下文详情':anchor.dataset.cuKind==='tokens'?'Token 用量详情':'速度统计详情');
    metricPanel.dataset.state='closed';metricPanel.hidden=false;renderMetricPanel();
    metricPanel.dataset.state='open';
    if(tooltip && !tooltip.hidden)hideQuota();
  }
  function closeMetricPanel(returnFocus=false) {
    const previous=panelAnchor;previous?.setAttribute('aria-expanded','false');panelAnchor=null;
    clearTimeout(panelCloseTimer);
    if(metricPanel){metricPanel.dataset.state='closed';panelCloseTimer=setTimeout(()=>{if(metricPanel)metricPanel.hidden=true;},160);}
    if(returnFocus && previous?.isConnected)previous.focus({preventScroll:true});
  }
  function positionMetricPanel() {
    if(!metricPanel || metricPanel.hidden || !panelAnchor?.isConnected)return;
    const a=panelAnchor.getBoundingClientRect(),p={width:metricPanel.offsetWidth,height:metricPanel.offsetHeight};
    if(a.bottom<0 || a.top>innerHeight){closeMetricPanel();return;}
    const above=a.top-p.height-10,below=a.bottom+10;
    const top=above>=12?above:below+p.height<=innerHeight-12?below:Math.max(12,Math.min(above,innerHeight-p.height-12));
    metricPanel.style.left=`${Math.max(12,Math.min(a.left,innerWidth-p.width-12))}px`;
    metricPanel.style.top=`${top}px`;
    metricPanel.style.transformOrigin=top<a.top?'bottom left':'top left';
  }
  function onOutsidePointer(event) {
    if(panelAnchor && !panelAnchor.contains(event.target) && !metricPanel?.contains(event.target))closeMetricPanel();
    if(tooltip && !tooltip.hidden && !ring?.contains(event.target) && !tooltip.contains(event.target))hideQuota();
  }
  function onPanelKeydown(event) {
    if(event.key==='Escape' && panelAnchor){event.preventDefault();event.stopPropagation();closeMetricPanel(true);}
    else if(event.key==='Escape' && tooltip && !tooltip.hidden)hideQuota();
  }
  function renderStrip() {
    const composer = [...document.querySelectorAll('[data-thread-find-composer]')].find(visible);
    if (!composer) { strip?.remove();return; }
    if (!strip) { strip = element('div','cu-strip');strip.setAttribute('aria-label','当前对话用量统计');strip.setAttribute('data-markdown-copy','exclude'); }
    const mount=composer.querySelector('[data-codex-usage-strip-slot]') ?? composer;
    alignComposerFooter(composer);
    if (strip.parentNode !== mount) mount.append(strip);
    if (!snapshot?.available) {
      setText(strip, currentId ? '用量统计 · 等待本地会话数据' : '用量统计 · 开始对话后显示');return;
    }
    const last = snapshot.turns?.at(-1);
    const running = last && !last.completed ? last : null;
    const items=[
      {key:'session',icon:'speed',kind:'session',text:`${snapshot.turnCount} 轮 ${snapshot.requests} 步 · ${speedLabel(last)}`},
      {key:'tokens',icon:'token',kind:'tokens',text:`${fmt(snapshot.total.total_tokens)} tok · 缓存命中 ${pct(snapshot.cacheHitPercent)}`},
      {key:'context',icon:'context',kind:'context',text:pct(snapshot.contextPercent)}
    ];
    if(running)items.push({key:'live',icon:'speed',kind:'live',text:`当前 ${running.averageTps?.toFixed(1)??'—'} tok/s`,live:true});
    updateMetrics(strip,items);
  }

  function alignComposerFooter(composer, remeasure=false) {
    const footer=composer.closest('[data-thread-scroll-footer]');
    if(!footer || adjustedFooters.has(footer) && !remeasure)return;
    // 把原生底部留白并入统计行，使文字在整个底部区域居中，输入框下移 8px。
    footer.classList.remove('cu-footer');
    const inset=parseFloat(getComputedStyle(footer).paddingBottom)||0;
    footer.style.setProperty('--cu-strip-height',`${30+Math.max(0,inset-8)}px`);
    footer.classList.add('cu-footer');adjustedFooters.add(footer);
  }
  function onResize() {
    const composer=[...document.querySelectorAll('[data-thread-find-composer]')].find(visible);
    if(composer)alignComposerFooter(composer,true);
    alignRenderedMetrics();
    positionTooltip();positionMetricPanel();
  }
  function renderTurns() {
    byId.clear();for(const t of snapshot?.turns??[])byId.set(t.id,t);
    const roots=[...document.querySelectorAll('[data-codex-usage-turn]')],seen=new Set();
    for(const root of roots.reverse()){
      const id=root.getAttribute('data-codex-usage-turn'),thread=root.getAttribute('data-codex-usage-thread');
      let footer=root.querySelector('.cu-turn');
      const turn=thread===currentId?byId.get(id):null;
      if(!turn?.completed || seen.has(id)){
        if(footer?.contains(panelAnchor))closeMetricPanel();footer?.remove();continue;
      }
      seen.add(id);
      const actions=[...root.querySelectorAll('[data-response-annotation-target] > .turn-action-controls')].at(-1)??root.querySelector('.actions.turn-action-controls');
      const mount=actions??root.querySelector('[data-codex-usage-turn-slot]')??root;
      if(!footer){footer=element('div','cu-turn');footer.setAttribute('data-markdown-copy','exclude');}
      const moved=footer.parentNode!==mount;if(moved)mount.append(footer);
      footer.classList.toggle('cu-turn-inline',!!actions);
      if(actions){actions.classList.add('cu-action-row');adjustedActionRows.add(actions);}
      updateMetrics(footer,[
        {key:'tokens',icon:'token',kind:'tokens',turnId:id,text:`用量 ${fmt(turn.usage.total_tokens)} tok`},
        {key:'cache',kind:'tokens',turnId:id,text:`缓存 ${pct(turn.cacheHitPercent)}`},
        {key:'speed',kind:'session',turnId:id,text:speedLabel(turn)}
      ]);
      if(moved)alignMetrics(footer);
    }
  }
  function svgCircle(radius, className) {
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    for (const [k,v] of Object.entries({cx:16,cy:16,r:radius,class:className})) c.setAttribute(k,String(v));return c;
  }
  function makeRing() {
    ring = element('div','cu-ring');ringButton = element('button');ringButton.type='button';
    ringButton.setAttribute('aria-label','Codex 剩余额度与重置时间');ringButton.setAttribute('aria-describedby','cu-quota-tooltip');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');
    svg.append(svgCircle(13,'cu-track'),svgCircle(13,'cu-remaining'),svgCircle(8,'cu-track'),svgCircle(8,'cu-time'));
    const text = document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x','16');text.setAttribute('y','16');svg.append(text);ringButton.append(svg);ring.append(ringButton);
    tooltip = element('div','cu-tooltip');tooltip.id='cu-quota-tooltip';tooltip.role='tooltip';tooltip.hidden=true;document.body.append(tooltip);
    const show=()=>{
      clearTimeout(quotaHideTimer);clearTimeout(quotaCloseTimer);closeMetricPanel();
      tooltip.dataset.state='closed';tooltip.hidden=false;renderTooltip();positionTooltip();
      tooltip.dataset.state='open';
    };
    const hide=()=>{quotaHideTimer=setTimeout(()=>{if(!tooltip.matches(':hover') && !ring.matches(':hover') && document.activeElement!==ringButton)hideQuota();},140);};
    ring.addEventListener('mouseenter',show);ring.addEventListener('mouseleave',hide);
    ringButton.addEventListener('focus',show);ringButton.addEventListener('blur',hide);
    ringButton.addEventListener('click',()=>tooltip.hidden || tooltip.dataset.state==='closed'?show():hideQuota());
    tooltip.addEventListener('mouseenter',()=>clearTimeout(quotaHideTimer));tooltip.addEventListener('mouseleave',hide);
  }
  function hideQuota() {
    clearTimeout(quotaHideTimer);clearTimeout(quotaCloseTimer);
    if(tooltip){tooltip.dataset.state='closed';quotaCloseTimer=setTimeout(()=>{if(tooltip)tooltip.hidden=true;},160);}
  }

  function selectedWindow() {
    const windows = snapshot?.limits?.groups?.flatMap(g=>g.windows.map(w=>({...w,groupName:g.name}))) ?? [];
    return windows.sort((a,b)=>a.remainingPercent-b.remainingPercent || a.windowMinutes-b.windowMinutes)[0] ?? null;
  }
  function positionTooltip() {
    if (!tooltip || tooltip.hidden || !ring?.isConnected) return;
    const r = ring.getBoundingClientRect(), t = {width:tooltip.offsetWidth,height:tooltip.offsetHeight};
    tooltip.style.left = `${Math.min(innerWidth-t.width-12,Math.max(12,r.right+10))}px`;
    tooltip.style.top = `${Math.max(12,Math.min(r.top,innerHeight-t.height-12))}px`;
  }
  function renderTooltip() {
    if (!tooltip || tooltip.hidden) return;
    const nodes=[];
    if (!snapshot?.limits) nodes.push(element('p','', '暂无可用额度数据'));
    for (const group of snapshot?.limits?.groups ?? []) for (const w of group.windows) {
      const box=element('div','cu-quota-detail');box.append(element('strong','',`${group.name} · ${w.label}`),
        element('p','',`剩余 ${pct(w.remainingPercent)} · 已用 ${pct(w.usedPercent)}`),
        element('p','',`距重置 ${countdown(w.resetsAt == null ? null : w.resetsAt-Date.now())}`),
        element('p','cu-muted',w.resetsAt == null ? '重置时间不可用' : `北京时间 ${new Date(w.resetsAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`));nodes.push(box);
    }
    const text=nodes.map(n=>n.textContent).join('|');
    if(tooltip.dataset.content!==text){tooltip.replaceChildren(...nodes);tooltip.dataset.content=text;}
  }
  function renderRing() {
    const rail = document.querySelector('[data-app-navigation-rail]');
    if (!rail) { ring?.remove();if(tooltip)tooltip.hidden=true;return; }
    if (!ring) makeRing();
    const slot=rail.querySelector('[data-codex-usage-ring-slot]');
    if(slot && ring.parentNode!==slot)slot.append(ring);
    if(tooltip && !tooltip.isConnected)document.body.append(tooltip);
    if (!slot && (!ring.isConnected || !rail.contains(ring))) {
      const download=[...rail.querySelectorAll('button,[role="button"]')].find(e=>/^(下载|Downloads?)(?:\b|$)|查看下载/i.test(e.getAttribute('aria-label')??e.getAttribute('title')??''));
      let anchor=download;
      if(anchor){while(anchor.parentElement!==rail && anchor.parentElement && !/column/.test(getComputedStyle(anchor.parentElement).flexDirection))anchor=anchor.parentElement;}
      if(anchor && anchor.parentElement!==rail && rail.contains(anchor.parentElement)) anchor.parentElement.insertBefore(ring,anchor);
      else rail.insertBefore(ring,anchor ?? rail.lastElementChild);
    }
    const w=selectedWindow(), remain=w?.remainingPercent, expired=w?.resetsAt != null && w.resetsAt<=Date.now();
    const left=w?.resetsAt == null?null:w.resetsAt-Date.now();
    const ratio=w && left != null ? Math.min(1,Math.max(0,left/(w.windowMinutes*60000))) : 0;
    const outer=ring.querySelector('.cu-remaining'), inner=ring.querySelector('.cu-time');
    outer.style.stroke=remain==null?'#8793a3':remain<=10?'#f26767':remain<=30?'#eeb866':'#79acfe';
    outer.style.strokeDasharray=`${2*Math.PI*13}`;outer.style.strokeDashoffset=`${2*Math.PI*13*(1-(remain??0)/100)}`;
    outer.style.opacity=remain==null || expired?'.45':'1';
    inner.style.stroke='#5ccbd9';inner.style.strokeDasharray=`${2*Math.PI*8}`;inner.style.strokeDashoffset=`${2*Math.PI*8*(1-ratio)}`;
    setText(ring.querySelector('text'),shortTime(left));
    ringButton.setAttribute('aria-label',w?`${w.label}剩余 ${pct(remain)}，距重置 ${countdown(left)}`:'Codex 额度暂不可用');
    renderTooltip();positionTooltip();
  }
  function render() {
    if(stopped || !document.body)return;
    injectStyle();
    for(const fn of [renderStrip,renderTurns,renderRing,renderMetricPanel])try{fn();}catch(e){console.warn('[CodexUsageUI]',fn.name,String(e));}
  }
  async function refresh() {
    if(stopped)return;
    const id=getThreadId();
    if(id!==currentId){closeMetricPanel();currentId=id;snapshot=null;render();}
    if(busy){pending=true;return;}
    busy=true;
    try {
      const next=await ipcRenderer.invoke(CHANNEL,{threadId:id});
      if(!stopped && id===getThreadId()){snapshot=next;render();}
    } catch (error) { console.warn('[CodexUsageUI]',String(error)); }
    finally {busy=false;if(pending){pending=false;void refresh();}}
  }
  function start() {
    if(stopped || !document.body)return;
    document.documentElement.dataset.cuUi='ready';
    const observer=new MutationObserver(records=>{
      if(records.every(r=>r.target.nodeType===1 && r.target.closest?.('.cu-strip,.cu-turn,.cu-ring,.cu-tooltip,.cu-panel,#codex-usage-ui-style')))return;
      if(timer)return;
      timer=setTimeout(()=>{timer=null;if(getThreadId()!==currentId)void refresh();else render();},180);
    });
    activeObserver=observer;
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',onResize);
    document.addEventListener('pointerdown',onOutsidePointer,true);
    document.addEventListener('keydown',onPanelKeydown,true);
    document.addEventListener('scroll',positionMetricPanel,true);void refresh();
    document.fonts?.ready.then(()=>{if(!stopped)alignRenderedMetrics();});
    const poll=setInterval(()=>void refresh(),1800);
    activePoll=poll;
    window.addEventListener('beforeunload',()=>window.__codexUsagePluginDispose?.(),{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
