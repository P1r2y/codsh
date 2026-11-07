'use strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function quotaPresentation(win) {
  await win.webContents.executeJavaScript(`(() => {
    const button=document.querySelector('.cu-ring button');button.focus();
    document.querySelector('.cu-ring').dispatchEvent(new MouseEvent('mouseenter'));
  })()`);
  const before = await win.webContents.executeJavaScript(`(() => {
    const ring=document.querySelector('.cu-ring'),button=ring.querySelector('button'),svg=ring.querySelector('svg');
    const b=button.getBoundingClientRect(),s=svg.getBoundingClientRect();
    return {hidden:document.querySelector('.cu-quota-panel').hidden,expanded:button.getAttribute('aria-expanded'),
      centerText:ring.querySelectorAll('text').length,circles:ring.querySelectorAll('circle').length,
      offsetX:b.x+b.width/2-s.x-s.width/2,offsetY:b.y+b.height/2-s.y-s.height/2};
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
  return {chat,entry,work,idle,reduced,checks:{
    chatMode:chat.strips===0&&chat.inset===24&&!chat.adjusted&&!chat.details&&chat.replies===2&&chat.ring,
    workMode:work.strips===1&&work.inset===0&&work.adjusted&&entry.same,
    stripEntry:entry.animations>0&&entry.opacity>0&&entry.opacity<1&&entry.transform!=='none'&&idle===0,
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
      const label=animations.find(a=>a.effect.target.matches('.cu-metric-label')&&a.effect.target.closest('[data-cu-key=tokens]'));
      if(label)label.currentTime=90;
      window.fixtureMetricChanges={animations:animations.length,labelOpacity:label?Number(getComputedStyle(label.effect.target).opacity):null,
        moved:animations.some(a=>a.effect.getKeyframes().some(frame=>/^translate\\(-?\\d/.test(frame.transform??''))),
        added:animations.some(a=>a.effect.target.matches('[data-cu-live]')&&a.effect.getKeyframes()[0].opacity==='0')};
      animations.forEach(a=>a.finish());
    });observer.observe(strip,{childList:true,subtree:true});
  })()`);
}

module.exports={quotaPresentation,modePresentation,watchMetricChanges};
