'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { RolloutStore } = require('./rollout-store.cjs');
const { READ_CHANNEL } = require('./protocol.cjs');

function register({isEnabled=()=>true}={}) {
  const {ipcMain,app,BrowserWindow} = require('electron'), store = new RolloutStore();
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
    if(!isEnabled())return {enabled:false,available:false};
    const id = request?.threadId ?? null;
    if (typeof id !== 'string' && id !== null) throw new Error('会话 ID 无效');
    return {...await store.read(id),enabled:true};
  });
}

module.exports = {register};
