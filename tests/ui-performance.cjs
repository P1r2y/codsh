'use strict';

async function performancePresentation(win) {
  return win.webContents.executeJavaScript(`(async()=>{
    const first=document.querySelector('[data-content-search-turn-key]'),root=document.querySelector('main.chat');
    const fragment=document.createDocumentFragment();
    for(let i=0;i<150;i++){
      const copy=first.cloneNode(true);copy.querySelectorAll('.cu-turn').forEach(n=>n.remove());
      const content=copy.querySelector('.response p');
      for(let j=0;j<20;j++)content.append(document.createElement('span'));
      fragment.append(copy);
    }
    root.append(fragment);
    await new Promise(resolve=>setTimeout(resolve,350));
    const nativeText=first.querySelector('.response p');
    document.dispatchEvent(new Event('codsh-performance-start'));
    const start=performance.now();
    try{
      for(let i=0;i<16;i++){
        nativeText.textContent='流式正文 '+i;
        await new Promise(resolve=>setTimeout(resolve,8));
      }
      await new Promise(resolve=>setTimeout(resolve,230));
      document.dispatchEvent(new Event('codsh-performance-read'));
      const {scans,layouts}=JSON.parse(document.documentElement.dataset.fixturePerformance);
      document.dispatchEvent(new Event('codsh-performance-start'));
      await new Promise(resolve=>setTimeout(resolve,4000));
      document.dispatchEvent(new Event('codsh-performance-read'));
      const live=JSON.parse(document.documentElement.dataset.fixturePerformance);
      return {scans,layouts,live,elapsed:performance.now()-start,checks:{streamingScans:scans<=2,streamingLayouts:layouts<400,
        liveScans:live.scans<=3,liveLayouts:live.layouts<150}};
    }finally{
      document.dispatchEvent(new Event('codsh-performance-read'));
    }
  })()`);
}

async function switchingPresentation(win,snapshots,fixture) {
  const original=fixture.snapshot,first=original.threadId,second='00000000-0000-4000-8000-000000000002';
  const longer=structuredClone(original);
  longer.turns=Array.from({length:80},(_,i)=>({...structuredClone(original.turns[0]),id:`row-${i}`}));
  longer.turnCount=80;longer.revision='switching-first';snapshots.set(first,longer);
  const other={...structuredClone(longer),threadId:second,revision:'switching-second'};
  other.turns.forEach(turn=>{turn.id='second-'+turn.id;});snapshots.set(second,other);
  await win.webContents.executeJavaScript(`(()=>{
    const main=document.querySelector('main.chat'),template=main.querySelector('[data-content-search-turn-key]').cloneNode(true);
    template.querySelectorAll('.cu-turn').forEach(n=>n.remove());main.replaceChildren();
    for(let i=0;i<80;i++){const row=template.cloneNode(true);row.dataset.contentSearchTurnKey='row-'+i;main.append(row);}
    window.fixtureBenchmarkSwitch=id=>{
      [...main.querySelectorAll('[data-content-search-turn-key]')].forEach((n,i)=>n.dataset.contentSearchTurnKey=(id===${JSON.stringify(first)}?'':'second-')+'row-'+i);
      main.querySelectorAll('[data-response-annotation-conversation]').forEach(n=>n.setAttribute('data-response-annotation-conversation',id));
      document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id);
    };
  })()`);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  await pause(700);
  const debuggerApi=win.webContents.debugger;debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Performance.enable');
    const read=async()=>Object.fromEntries((await debuggerApi.sendCommand('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const before=await read();
    await win.webContents.executeJavaScript(`window.fixtureBenchmarkSwitch(${JSON.stringify(second)})`);await pause(500);
    await win.webContents.executeJavaScript(`window.fixtureBenchmarkSwitch(${JSON.stringify(first)})`);await pause(500);
    const after=await read();
    const state=await win.webContents.executeJavaScript(`({count:document.querySelectorAll('.cu-turn').length,thread:document.querySelector('.cu-strip')?.dataset.cuThread,errors:window.fixtureErrors})`);
    const sample=Object.fromEntries(['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration'].map(k=>[k,after[k]-before[k]]));
    return {sample,state,checks:{switchReplies:state.count===80&&state.thread===first,switchLayout:sample.LayoutCount<70,switchErrors:state.errors.length===0}};
  } finally {debuggerApi.detach();}
}

module.exports={performancePresentation,switchingPresentation};
