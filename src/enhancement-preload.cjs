'use strict';
(()=>{
  const {ipcRenderer}=require('electron');
  const {STATE_CHANNEL}=require('./protocol.cjs');
  let currentKey=null,busy=false,stopped=false;
  async function sync(){
    if(busy || stopped)return;
    busy=true;
    try{
      const state=await ipcRenderer.invoke(STATE_CHANNEL);
      if(stopped)return;
      if(!state.enabled || state.key!==currentKey){
        window.__codexUsagePluginDispose?.();currentKey=null;
      }
      if(state.enabled && !currentKey && typeof state.code==='string'){
        // 安装的本地增强插件在预加载隔离世界中运行。
        new Function('require',state.code)(require);
        currentKey=state.key;
      }
    }catch(e){console.warn('[CodexEnhancementLoader]',String(e));}
    finally{busy=false;}
  }
  void sync();
  const interval=setInterval(()=>void sync(),2000);
  window.addEventListener('beforeunload',()=>{stopped=true;clearInterval(interval);window.__codexUsagePluginDispose?.();},{once:true});
})();
