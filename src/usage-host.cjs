'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {WorkerClient} = require('./worker-client.cjs');
const { READ_CHANNEL, CHANGE_CHANNEL } = require('./protocol.cjs');
const { LogWatchSet } = require('./log-watch.cjs');

function register({isEnabled=()=>true}={}) {
  const {ipcMain,app,BrowserWindow} = require('electron');
  const reader = new WorkerClient(path.join(__dirname,'usage-worker.cjs'));
  const watches=new LogWatchSet((owner,message)=>{if(isEnabled())owner.send(CHANGE_CHANNEL,message);});
  const generations=new WeakMap();
  app.once('will-quit',()=>{watches.dispose();void reader.dispose();});
  // 使用商店安装包的原始透明图标，随 Windows 任务栏主题选择黑色或白色版本。
  const {nativeTheme}=require('electron');
  const applyWindowIcon=win=>{
    if(win.isDestroyed())return;
    const dark=nativeTheme.shouldUseDarkColorsForSystemIntegratedUI??nativeTheme.shouldUseDarkColors;
    const original=path.join(__dirname,'..','assets','app-icons',`Square44x44Logo.targetsize-32_altform-${dark?'unplated':'lightunplated'}.png`);
    const file=[original,path.join(process.resourcesPath,'codex.ico'),
      path.join(os.homedir(),'AppData','Local','Programs','OpenAI','Codex','codex.ico')].find(file=>fs.existsSync(file));
    if(file)win.setIcon(file);
  };
  if(process.platform==='win32'){
    app.on('browser-window-created',(_event,win)=>{
      applyWindowIcon(win);win.once('ready-to-show',()=>applyWindowIcon(win));
    });
    app.whenReady().then(()=>BrowserWindow.getAllWindows().forEach(applyWindowIcon));
    nativeTheme.on('updated',()=>setImmediate(()=>BrowserWindow.getAllWindows().forEach(applyWindowIcon)));
  }
  ipcMain.handle(READ_CHANNEL, async(event, request)=>{
    const url = event.senderFrame?.url ?? '';
    if (!url.startsWith('app://') && !url.startsWith('file://')) throw new Error('界面来源不受支持');
    if(!isEnabled()){watches.select(event.sender,null,null);return {enabled:false,available:false};}
    const id = request?.threadId ?? null;
    if (typeof id !== 'string' && id !== null) throw new Error('会话 ID 无效');
    const knownRevision = typeof request?.knownRevision === 'string' ? request.knownRevision : undefined;
    const generation=(generations.get(event.sender)??0)+1;
    if(!request?.quotaOnly)generations.set(event.sender,generation);
    const {snapshot,filename}=await reader.request('read',{threadId:id,knownRevision});
    // A quota read is independent of the active conversation subscription.
    const eventDriven=request?.quotaOnly||generations.get(event.sender)!==generation ? false : watches.select(event.sender,id?.toLowerCase(),filename);
    return {...snapshot,enabled:true,eventDriven};
  });
}

module.exports = {register};
