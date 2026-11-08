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
      return {scans,layouts,elapsed:performance.now()-start,checks:{streamingScans:scans<=2,streamingLayouts:layouts<400}};
    }finally{
      document.dispatchEvent(new Event('codsh-performance-read'));
    }
  })()`);
}

module.exports={performancePresentation};
