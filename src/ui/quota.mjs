import { element, setText } from './elements.mjs';
import { pct, countdown, shortTime } from './format.mjs';

export function createQuotaWidget(onOpen) {
  let snapshot = null, ring = null, ringButton = null, tooltip = null;
  let quotaHideTimer = null, quotaCloseTimer = null;

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
      clearTimeout(quotaHideTimer);clearTimeout(quotaCloseTimer);onOpen();
      tooltip.dataset.state='closed';tooltip.hidden=false;renderTooltip();positionTooltip();
      tooltip.dataset.state='open';
    };
    const hide=()=>{
      clearTimeout(quotaHideTimer);
      quotaHideTimer=setTimeout(()=>{
        if(tooltip && ring && !tooltip.matches(':hover') && !ring.matches(':hover') && document.activeElement!==ringButton)hideQuota();
      },140);
    };
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
  function render(value, mount) {
    snapshot = value;
    if (!mount) { ring?.remove(); if (tooltip) tooltip.hidden = true; return; }
    if (!ring) makeRing();
    if (!tooltip.isConnected) document.body.append(tooltip);
    if (ring.parentNode !== mount.parent || ring.nextSibling !== mount.before) mount.parent.insertBefore(ring, mount.before);
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
  return {
    render,
    hide: hideQuota,
    position: positionTooltip,
    outside(event) { if (tooltip && !tooltip.hidden && !ring?.contains(event.target) && !tooltip.contains(event.target)) hideQuota(); },
    keydown(event) { if (event.key === 'Escape' && tooltip && !tooltip.hidden) hideQuota(); },
    dispose() {
      clearTimeout(quotaHideTimer); clearTimeout(quotaCloseTimer);
      ring?.remove(); tooltip?.remove(); snapshot = null;
      ring = null; ringButton = null; tooltip = null;
    }
  };
}
