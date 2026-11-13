import { element } from './elements.mjs';
import { pct, countdown } from './format.mjs';
import quotaModel from '../quota-model.cjs';

const remainingRadius = 14, timeRadius = 10;

export function createQuotaWidget(onOpen) {
  let snapshot = null, ring = null, ringButton = null, panel = null;
  let closeTimer = null;

  function svgCircle(radius, className) {
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    for (const [k,v] of Object.entries({cx:16,cy:16,r:radius,class:className})) c.setAttribute(k,String(v));return c;
  }

  function makeRing() {
    ring = element('div','cu-ring');ringButton = element('button');ringButton.type='button';
    ringButton.setAttribute('aria-label','Codex 剩余额度与重置时间');
    ringButton.setAttribute('aria-haspopup','dialog');ringButton.setAttribute('aria-expanded','false');
    ringButton.setAttribute('aria-controls','cu-quota-popover');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');
    svg.append(svgCircle(remainingRadius,'cu-track'),svgCircle(remainingRadius,'cu-remaining'),
      svgCircle(timeRadius,'cu-track'),svgCircle(timeRadius,'cu-time'));
    const symbol = document.createElementNS('http://www.w3.org/2000/svg','g');
    symbol.setAttribute('transform','translate(16 16) scale(1.1428571429) translate(-6 -6)');symbol.setAttribute('class','cu-diamond');
    const diamond = document.createElementNS('http://www.w3.org/2000/svg','path');
    diamond.setAttribute('d','M5.00978 1.81069C5.55652 1.26395 6.44352 1.26395 6.99025 1.81069L10.1895 5.0099C10.7361 5.55665 10.7362 6.44367 10.1895 6.99037L6.99025 10.1896C6.44355 10.7363 5.55652 10.7362 5.00978 10.1896L1.81056 6.99037C1.26383 6.44364 1.26383 5.55664 1.81056 5.0099L5.00978 1.81069Z');
    symbol.append(diamond);svg.append(symbol);
    svg.setAttribute('aria-hidden','true');ringButton.append(svg);ring.append(ringButton);
    panel = element('div','cu-quota-panel');panel.id='cu-quota-popover';panel.role='dialog';
    panel.setAttribute('aria-label','Codex 额度');panel.hidden=true;document.body.append(panel);
    ringButton.addEventListener('click',()=>panel.dataset.state==='open'?hideQuota():showQuota());
  }

  function showQuota() {
    clearTimeout(closeTimer);onOpen();
    panel.dataset.state='closed';panel.hidden=false;
    renderPanel();positionPanel();
    // 先提交定位和初始透明度，再淡入同一个完整面板，避免背景缩放偏移。
    panel.getBoundingClientRect();
    panel.dataset.state='open';ringButton.setAttribute('aria-expanded','true');
  }

  function hideQuota(immediate = false) {
    clearTimeout(closeTimer);
    ringButton?.setAttribute('aria-expanded','false');
    if (!panel) return;
    panel.dataset.state='closed';
    if (immediate) panel.hidden=true;
    else closeTimer=setTimeout(()=>{if(panel)panel.hidden=true;},160);
  }

  function selectedWindow() {
    return quotaModel.quotaWindow(snapshot?.limits);
  }

  function positionPanel() {
    if (!panel || panel.hidden || !ring?.isConnected) return;
    const r = ring.getBoundingClientRect(), t = {width:panel.offsetWidth,height:panel.offsetHeight};
    panel.style.left = `${Math.min(innerWidth-t.width-12,Math.max(12,r.right+10))}px`;
    panel.style.top = `${Math.max(12,Math.min(r.top,innerHeight-t.height-12))}px`;
  }

  function renderPanel() {
    if (!panel || panel.hidden) return;
    const nodes=[];
    if (!snapshot?.limits) nodes.push(element('p','', '暂无可用额度数据'));
    for (const group of snapshot?.limits?.groups ?? []) for (const w of group.windows) {
      const expired=w.resetsAt != null && w.resetsAt<=Date.now();
      const box=element('div','cu-quota-detail');box.append(element('strong','',`${group.name} · ${w.label}`),
        element('p','',`剩余 ${pct(expired?null:w.remainingPercent)} · 已用 ${pct(expired?null:w.usedPercent)}`),
        element('p','',`距重置 ${countdown(w.resetsAt == null ? null : w.resetsAt-Date.now())}`),
        element('p','cu-muted',w.resetsAt == null ? '重置时间不可用' : `北京时间 ${new Date(w.resetsAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`));nodes.push(box);
    }
    const text=nodes.map(n=>n.textContent).join('|');
    if(panel.dataset.content!==text){panel.replaceChildren(...nodes);panel.dataset.content=text;}
  }
  function render(value, mount) {
    snapshot = value;
    if (!mount) { ring?.remove(); hideQuota(true); return; }
    if (!ring) makeRing();
    if (!panel.isConnected) document.body.append(panel);
    if (ring.parentNode !== mount.parent || ring.nextSibling !== mount.before) mount.parent.insertBefore(ring, mount.before);
    const w=selectedWindow(), expired=w?.resetsAt != null && w.resetsAt<=Date.now(), remain=expired?null:w?.remainingPercent;
    const left=w?.resetsAt == null?null:w.resetsAt-Date.now();
    const ratio=w && left != null ? Math.min(1,Math.max(0,left/(w.windowMinutes*60000))) : 0;
    const outer=ring.querySelector('.cu-remaining'), inner=ring.querySelector('.cu-time');
    outer.style.stroke=remain==null?'var(--color-usage-meter-track,#72757c)':remain<=10?'var(--color-usage-meter-warning,#d87474)':remain<=30?'var(--color-usage-meter-warning,#c6a66f)':'var(--color-usage-meter-fill,#a2a6ad)';
    outer.style.strokeDasharray=`${2*Math.PI*remainingRadius}`;outer.style.strokeDashoffset=`${2*Math.PI*remainingRadius*(1-(remain??0)/100)}`;
    outer.style.opacity=remain>0?'1':'0';
    inner.style.stroke='color-mix(in srgb,var(--color-usage-meter-fill,#a2a6ad) 60%,transparent)';
    inner.style.strokeDasharray=`${2*Math.PI*timeRadius}`;inner.style.strokeDashoffset=`${2*Math.PI*timeRadius*(1-ratio)}`;
    inner.style.opacity=ratio>0?'1':'0';
    ringButton.setAttribute('aria-label',expired?'Codex 额度待更新':w?`${w.label}剩余 ${pct(remain)}，距重置 ${countdown(left)}`:'Codex 额度暂不可用');
    renderPanel();positionPanel();
  }
  return {
    render,
    hide: hideQuota,
    position: positionPanel,
    outside(event) { if (panel?.dataset.state==='open' && !ring?.contains(event.target) && !panel.contains(event.target)) hideQuota(); },
    keydown(event) {
      if (event.key === 'Escape' && panel?.dataset.state==='open') {
        event.preventDefault();hideQuota();ringButton?.focus({preventScroll:true});
      }
    },
    dispose() {
      clearTimeout(closeTimer);
      ring?.remove(); panel?.remove(); snapshot = null;
      ring = null; ringButton = null; panel = null;
    }
  };
}
