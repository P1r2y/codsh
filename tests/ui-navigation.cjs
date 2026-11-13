'use strict';

async function navigationPresentation(win, snapshots, delays, fixture) {
  const first=fixture.snapshot.threadId,second='00000000-0000-4000-8000-000000000002';
  const next=structuredClone(fixture.snapshot);next.threadId=second;next.revision='nav-second';next.requests=73;
  snapshots.set(second,next);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const state=()=>win.webContents.executeJavaScript(`(()=>{
    const strip=document.querySelector('.cu-strip'),active=[...document.querySelectorAll('[data-fixture-pane]')].find(n=>n.getClientRects().length>0&&getComputedStyle(n).display!=='none');
    return {thread:strip?.dataset.cuThread,text:strip?.textContent,mounted:!!active?.contains(strip),
      replies:active?.querySelectorAll('.cu-turn').length,errors:window.fixtureErrors};
  })()`);
  await win.webContents.executeJavaScript(`(()=>{
    const style=document.createElement('style');style.textContent='.fixture-hidden{display:none!important}';document.head.append(style);
    const pane=document.createElement('section');pane.dataset.fixturePane='first';
    const main=document.querySelector('main.chat'),footer=document.querySelector('[data-thread-scroll-footer]');
    main.before(pane);pane.append(main,footer);
    const other=pane.cloneNode(true);other.dataset.fixturePane='second';other.classList.add('fixture-hidden');
    other.querySelectorAll('.cu-turn,.cu-strip').forEach(n=>n.remove());
    other.querySelectorAll('[data-response-annotation-conversation]').forEach(n=>n.setAttribute('data-response-annotation-conversation',${JSON.stringify(second)}));
    other.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',${JSON.stringify(second)});
    pane.after(other);
    window.fixtureSwitch=name=>{pane.classList.toggle('fixture-hidden',name!=='first');other.classList.toggle('fixture-hidden',name!=='second');};
  })()`);
  await pause(250);
  await win.webContents.executeJavaScript(`document.querySelector('.cu-strip').remove()`);
  await pause(300);const removed=await state();
  await win.webContents.executeJavaScript(`window.fixtureSwitch('second')`);
  await pause(350);const switched=await state();
  await win.webContents.executeJavaScript(`window.fixtureSwitch('first')`);
  await pause(350);const returned=await state();
  // An unchanged response must still recover a detached strip on focus.
  await win.webContents.executeJavaScript(`document.querySelector('.cu-strip')?.remove();window.dispatchEvent(new Event('focus'))`);
  await pause(250);const unchanged=await state();
  delays.set(second,1800);
  await win.webContents.executeJavaScript(`window.fixtureSwitch('second')`);await pause(120);
  await win.webContents.executeJavaScript(`window.fixtureSwitch('first')`);await pause(250);
  const quick=await state();await pause(1800);
  const settled=await state();
  await win.webContents.executeJavaScript(`(()=>{
    const first=document.querySelector('[data-fixture-pane=first]'),second=document.querySelector('[data-fixture-pane=second]');
    second.style.display='none';second.classList.remove('fixture-hidden');first.style.display='none';second.style.display='';
  })()`);await pause(300);const styleSwitch=await state();
  return {removed,switched,returned,unchanged,quick,settled,styleSwitch,checks:{
    removedStrip:removed.mounted&&removed.thread===first,
    cssNavigation:switched.mounted&&switched.thread===second&&switched.text.includes('73 步'),
    cssReturn:returned.mounted&&returned.thread===first&&returned.replies===2,
    unchangedRemount:unchanged.mounted&&unchanged.thread===first,
    slowReadReturn:quick.mounted&&quick.thread===first&&!quick.text.includes('等待')&&settled.thread===first,
    styleNavigation:styleSwitch.mounted&&styleSwitch.thread===second&&styleSwitch.replies===2,
    noErrors:[removed,switched,returned,unchanged,quick,settled].every(v=>v.errors.length===0)
  }};
}

module.exports={navigationPresentation};
