'use strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function footerInsetPresentation(win) {
  const samples=[];
  for(const inset of [0,8,16,24]) {
    await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]');footer.dataset.fixtureAfterInset='';footer.classList.add('after:h-(--thread-composer-bottom-inset)');footer.style.setProperty('--thread-composer-bottom-inset','${inset}px');window.dispatchEvent(new Event('resize'));})()`);
    await delay(250);
    samples.push(await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]'),composer=document.querySelector('.composer').getBoundingClientRect(),strip=document.querySelector('.cu-strip').getBoundingClientRect(),bottom=footer.getBoundingClientRect().bottom;return {inset:${inset},after:parseFloat(getComputedStyle(footer,'::after').height),stripHeight:strip.height,offset:strip.top+strip.height/2-(composer.bottom+bottom)/2};})()`));
  }
  await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]');footer.classList.remove('after:h-(--thread-composer-bottom-inset)');window.dispatchEvent(new Event('resize'));})()`);
  await delay(250);
  const otherAfter=await win.webContents.executeJavaScript(`parseFloat(getComputedStyle(document.querySelector('[data-thread-scroll-footer]'),'::after').height)`);
  await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]');footer.classList.add('after:h-(--thread-composer-bottom-inset)');window.dispatchEvent(new Event('resize'));document.querySelector('[data-thread-find-composer]').setAttribute('data-chatgpt-composer','');})()`);
  await delay(400);
  const chat=await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]');return {after:parseFloat(getComputedStyle(footer,'::after').height),strip:!!footer.querySelector('.cu-strip'),adjusted:footer.classList.contains('cu-footer')};})()`);
  await win.webContents.executeJavaScript(`(()=>{const footer=document.querySelector('[data-thread-scroll-footer]');delete footer.dataset.fixtureAfterInset;footer.classList.remove('after:h-(--thread-composer-bottom-inset)');footer.style.removeProperty('--thread-composer-bottom-inset');document.querySelector('[data-thread-find-composer]').removeAttribute('data-chatgpt-composer');})()`);
  await delay(400);
  return {samples,otherAfter,chat,checks:{
    nativeFooterCentered:samples.every(s=>Math.abs(s.offset)<.1&&s.after===0),
    nativeFooterRestore:otherAfter===24&&chat.after===24&&!chat.strip&&!chat.adjusted
  }};
}

async function quotaPresentation(win) {
  await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('.cu-ring button');button.focus();
    document.querySelector('.cu-ring').dispatchEvent(new MouseEvent('mouseenter'));
  })()`);
  const before = await win.webContents.executeJavaScript(`(() => {
    const ring=document.querySelector('.cu-ring'),button=ring.querySelector('button'),svg=ring.querySelector('svg');
    const b=button.getBoundingClientRect(),s=svg.getBoundingClientRect(),diamond=ring.querySelector('.cu-diamond');
    const d=diamond?.getBBox(),matrix=diamond?.getScreenCTM();
    const native=document.querySelector('.native-usage');
    return {hidden:document.querySelector('.cu-quota-panel').hidden,expanded:button.getAttribute('aria-expanded'),
      centerText:ring.querySelectorAll('text').length,circles:ring.querySelectorAll('circle').length,
      offsetX:b.x+b.width/2-s.x-s.width/2,offsetY:b.y+b.height/2-s.y-s.height/2,
      diamond:!!d,diamondX:d?matrix.a*(d.x+d.width/2)+matrix.e-(b.x+b.width/2):null,
      diamondY:d?matrix.d*(d.y+d.height/2)+matrix.f-(b.y+b.height/2):null,
      nativeHidden:native?.getClientRects().length===0,nativePosition:ring.nextElementSibling===native,
      radius:[...ring.querySelectorAll('.cu-track')].map(node=>Number(node.getAttribute('r'))),
      stroke:parseFloat(getComputedStyle(ring.querySelector('.cu-remaining')).strokeWidth)*s.width/svg.viewBox.baseVal.width};
  })()`);
  const fade = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.cu-ring button').click();
    const p=document.querySelector('.cu-quota-panel'),animations=p.getAnimations();
    for(const a of animations)a.currentTime=80;
    const style=getComputedStyle(p),rect=p.getBoundingClientRect();
    const state={opacity:Number(style.opacity),transform:style.transform,property:style.transitionProperty,
      offsetX:rect.x-parseFloat(style.left),offsetY:rect.y-parseFloat(style.top),animations:animations.length};
    animations.forEach(a=>a.finish());return state;
  })()`);
  await delay(180);
  const opened = await win.webContents.executeJavaScript(`(() => {
    const p=document.querySelector('.cu-quota-panel'),s=getComputedStyle(p);
    return {visible:!p.hidden&&p.dataset.state==='open',text:p.textContent,background:s.backgroundColor,
      radius:s.borderRadius,shadow:s.boxShadow,blur:s.backdropFilter,role:p.role,
      expanded:document.querySelector('.cu-ring button').getAttribute('aria-expanded')};
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('.cu-ring').dispatchEvent(new MouseEvent('mouseleave'));document.querySelector('.cu-ring button').blur()`);
  await delay(180);
  const persists = await win.webContents.executeJavaScript(`document.querySelector('.cu-quota-panel').dataset.state==='open'`);
  await win.webContents.executeJavaScript(`document.querySelector('.cu-ring button').click()`);
  await delay(180);
  const toggled = await win.webContents.executeJavaScript(`document.querySelector('.cu-quota-panel').hidden&&document.querySelector('.cu-ring button').getAttribute('aria-expanded')==='false'`);
  await win.webContents.executeJavaScript(`document.querySelector('.cu-ring button').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await delay(180);
  const escaped = await win.webContents.executeJavaScript(`document.querySelector('.cu-quota-panel').hidden&&document.activeElement===document.querySelector('.cu-ring button')`);
  await win.webContents.executeJavaScript(`document.querySelector('.cu-ring button').click();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  await delay(180);
  const outside = await win.webContents.executeJavaScript(`document.querySelector('.cu-quota-panel').hidden`);
  await win.webContents.executeJavaScript(`const button=document.querySelector('.cu-ring button');button.click();button.click();button.click()`);
  await delay(180);
  const reopened = await win.webContents.executeJavaScript(`!document.querySelector('.cu-quota-panel').hidden&&document.querySelector('.cu-quota-panel').dataset.state==='open'`);
  return {before,fade,opened,persists,toggled,escaped,outside,reopened,checks:{
    quotaCenter:before.centerText===0&&before.circles===4&&Math.abs(before.offsetX)<.1&&Math.abs(before.offsetY)<.1,
    quotaDiamond:before.diamond&&Math.abs(before.diamondX)<.1&&Math.abs(before.diamondY)<.1&&before.radius.join(',')==='14,10'&&Math.abs(before.stroke-1.75)<.001,
    nativeQuotaHidden:before.nativeHidden&&before.nativePosition,
    quotaClickOnly:before.hidden&&before.expanded==='false'&&opened.visible&&opened.role==='dialog'&&opened.expanded==='true'&&persists,
    quotaFade:fade.animations>0&&fade.opacity>0&&fade.opacity<1&&fade.transform==='none'&&fade.property==='opacity'&&Math.abs(fade.offsetX)<.1&&Math.abs(fade.offsetY)<.1,
    quotaDismissal:toggled&&escaped&&outside&&reopened
  }};
}

async function modePresentation(win) {
  const state = () => win.webContents.executeJavaScript(`(() => {
    const footer=document.querySelector('[data-thread-scroll-footer]');
    return {strips:document.querySelectorAll('.cu-strip').length,inset:parseFloat(getComputedStyle(footer).paddingBottom),
      adjusted:footer.classList.contains('cu-footer'),details:!!document.querySelector('.cu-panel[data-state=open]'),
      replies:document.querySelectorAll('.cu-turn').length,ring:!!document.querySelector('.cu-ring')};
  })()`);
  const restore = () => win.webContents.executeJavaScript(`new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('底栏未恢复'));},2400);
    const observer=new MutationObserver(()=>{
      const strip=document.querySelector('.cu-strip');if(!strip)return;
      observer.disconnect();clearTimeout(timer);
      const animations=strip.getAnimations(),animation=animations.find(a=>a.effect.target===strip);
      if(animation)animation.currentTime=110;
      const style=getComputedStyle(strip),result={same:strip===window.fixtureStrip,animations:animations.length,
        opacity:Number(style.opacity),transform:style.transform,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
      strip.getAnimations({subtree:true}).forEach(a=>a.finish());resolve(result);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    document.querySelector('[data-thread-find-composer]').removeAttribute('data-chatgpt-composer');
  })`);
  await win.webContents.executeJavaScript(`window.fixtureStrip=document.querySelector('.cu-strip');document.querySelector('.cu-strip [data-cu-kind=tokens]').click();document.querySelector('[data-thread-find-composer]').setAttribute('data-chatgpt-composer','')`);
  await delay(400);const chat=await state();
  await win.webContents.executeJavaScript(`(() => {const hidden=document.createElement('form');hidden.hidden=true;hidden.dataset.chatgptComposer='';hidden.dataset.fixtureHiddenChat='true';document.querySelector('[data-thread-find-composer]').append(hidden);})()`);
  const entry=await restore();await delay(260);const work=await state();
  const idle=await win.webContents.executeJavaScript(`document.querySelector('.cu-strip').getAnimations({subtree:true}).length`);
  const reordered=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const root=document.querySelector('[data-thread-find-composer]'),strip=document.querySelector('.cu-strip'),after=document.createElement('span');
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('底栏未重新定位'));},2000);
    const observer=new MutationObserver(()=>{
      if(strip!==root.lastElementChild)return;
      observer.disconnect();clearTimeout(timer);
      const replay=strip.getAnimations().length;after.remove();resolve({same:strip===window.fixtureStrip,replay});
    });observer.observe(root,{childList:true});root.append(after);
  })`);
  const debuggerApi=win.webContents.debugger;debuggerApi.attach('1.3');
  let reduced;
  try {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await delay(80);
    await win.webContents.executeJavaScript(`document.querySelector('[data-thread-find-composer]').setAttribute('data-chatgpt-composer','')`);
    await delay(240);reduced=await restore();
  } finally {
    await debuggerApi.sendCommand('Emulation.setEmulatedMedia',{features:[]});debuggerApi.detach();
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-fixture-hidden-chat]').remove()`);
  return {chat,entry,work,idle,reordered,reduced,checks:{
    chatMode:chat.strips===0&&chat.inset===24&&!chat.adjusted&&!chat.details&&chat.replies===2&&chat.ring,
    workMode:work.strips===1&&work.inset===0&&work.adjusted&&entry.same,
    stripEntry:entry.animations>0&&entry.opacity>0&&entry.opacity<1&&entry.transform!=='none'&&idle===0,
    stripNoReplay:reordered.same&&reordered.replay===0,
    reducedMotion:reduced.reduced&&reduced.animations===0&&reduced.opacity===1&&reduced.transform==='none'
  }};
}

async function watchMetricChanges(win) {
  await win.webContents.executeJavaScript(`(() => {
    const strip=document.querySelector('.cu-strip');
    const observer=new MutationObserver(()=>{
      if(!strip.querySelector('[data-cu-live]'))return;
      observer.disconnect();
      const animations=strip.getAnimations({subtree:true});
      const label=strip.querySelector('[data-cu-key=tokens] .cu-metric-label');
      window.fixtureMetricChanges={animations:animations.length,labelOpacity:Number(getComputedStyle(label).opacity),tweens:label.querySelectorAll('[data-cu-tween]').length,
        moved:animations.some(a=>a.effect.getKeyframes().some(frame=>/^translate\\(-?\\d/.test(frame.transform??''))),
        added:animations.some(a=>a.effect.target.matches('[data-cu-live]')&&a.effect.getKeyframes()[0].opacity==='0')};
      animations.forEach(a=>a.finish());
    });observer.observe(strip,{childList:true,subtree:true});
  })()`);
}

async function nativeQuotaPresentation(win) {
  const state = () => win.webContents.executeJavaScript(`(() => {
    const ring=document.querySelector('.cu-ring'),native=document.querySelector('.native-usage');
    return {rings:document.querySelectorAll('.cu-ring').length,hidden:native?.getClientRects().length===0,
      anchored:native?ring.nextElementSibling===native:ring.nextElementSibling?.classList.contains('download'),
      downloads:document.querySelector('.download').getClientRects().length>0,profile:document.querySelector('.profile').getClientRects().length>0};
  })()`);
  await win.webContents.executeJavaScript(`(() => {const native=document.querySelector('.native-usage');window.fixtureNativeQuota=native.cloneNode(true);native.replaceWith(window.fixtureNativeQuota);})()`);
  await delay(250);const replacement=await state();
  await win.webContents.executeJavaScript(`window.fixtureNativeQuota.remove()`);
  await delay(250);const absent=await state();
  await win.webContents.executeJavaScript(`document.querySelector('.download').before(window.fixtureNativeQuota)`);
  await delay(250);const returned=await state();
  return {replacement,absent,returned,checks:{
    nativeQuotaLifecycle:[replacement,returned].every(s=>s.rings===1&&s.hidden&&s.anchored&&s.downloads&&s.profile)&&absent.rings===1&&absent.anchored&&absent.downloads&&absent.profile
  }};
}

async function numberPresentation(win, update) {
  await win.webContents.executeJavaScript(`(() => {
    window.fixtureNumberProbe=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        observer.disconnect();const label=document.querySelector('[data-cu-live] .cu-metric-label');
        reject(new Error('数字递变没有完成：'+JSON.stringify({text:label?.textContent,target:label?.dataset.cuText,pending:!!label?.querySelector('[data-cu-tween]')})));
      },6000);
      const observer=new MutationObserver(()=>{
        const label=document.querySelector('[data-cu-live] .cu-metric-label');
        if(label?.dataset.cuText!=='当前 44.8 tok/s'||!label.querySelector('[data-cu-tween]'))return;
        observer.disconnect();const samples=[];
        const sample=now=>{
          const r=label.getBoundingClientRect(),style=getComputedStyle(label);
          samples.push({text:label.textContent,value:Number(label.querySelector('.cu-number').textContent),
            opacity:Number(style.opacity),buttonOpacity:Number(getComputedStyle(label.parentElement).opacity),x:r.x,width:r.width,time:now});
          if(label.querySelector('[data-cu-tween]'))requestAnimationFrame(sample);
          else{clearTimeout(timer);resolve({samples,stable:label===document.querySelector('[data-cu-live] .cu-metric-label')});}
        };requestAnimationFrame(sample);
      });observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-cu-text','data-cu-tween']});
    });
  })()`);
  update();
  const result=await win.webContents.executeJavaScript(`window.fixtureNumberProbe`),samples=result.samples;
  return {...result,checks:{
    // 隐藏窗口的 rAF 约为 1 Hz；递变过程另用受控时钟验证，这里检查真实布局和亮度。
    numberStable:result.stable&&samples.length>=2&&samples[0].value===62.5&&samples.at(-1).value===44.8&&samples.every(s=>s.opacity===1&&s.buttonOpacity===1&&s.text.replace(/[\d,.]+/g,'#')==='当前 # tok/s'),
    numberLayout:Math.max(...samples.map(s=>s.x))-Math.min(...samples.map(s=>s.x))<.1&&Math.max(...samples.map(s=>s.width))-Math.min(...samples.map(s=>s.width))<.1
  }};
}

module.exports={quotaPresentation,modePresentation,watchMetricChanges,nativeQuotaPresentation,numberPresentation,footerInsetPresentation};
