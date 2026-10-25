'use strict';
// 加载器只提供生命周期与本地插件入口，统计和界面代码留在独立插件目录。
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {STATE_CHANNEL}=require('./protocol.cjs');

function register(){
  const {ipcMain}=require('electron');
  const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const runtimeConfig=path.join(process.resourcesPath,'codsh-loader.json');
  const base=fs.existsSync(runtimeConfig)
    ? path.resolve(process.resourcesPath,readJson(runtimeConfig).base)
    : path.resolve(process.resourcesPath,'..','..');
  const plugin=path.join(base,'plugins','codex-usage');
  const configuration=path.join(base,'plugins.json');
  function isEnabled(){
    try{return readJson(configuration).plugins?.['codex-usage']?.enabled===true;}
    catch{return false;}
  }
  function resolveEntry(relative){
    const target=path.resolve(plugin,relative);
    if(!target.startsWith(plugin+path.sep))throw new Error('插件入口超出插件目录');
    return target;
  }
  if(!fs.existsSync(path.join(plugin,'plugin.json'))){
    ipcMain.handle(STATE_CHANNEL,()=>({enabled:false}));return;
  }
  const manifest=readJson(path.join(plugin,'plugin.json'));
  require(resolveEntry(manifest.host)).register({isEnabled});
  let cache=null;
  ipcMain.handle(STATE_CHANNEL,event=>{
    if(!event.senderFrame?.url?.startsWith('app://'))return {enabled:false};
    if(!isEnabled())return {enabled:false};
    const file=resolveEntry(manifest.preload),stat=fs.statSync(file);
    if(!cache || cache.modified!==stat.mtimeMs){
      const code=fs.readFileSync(file,'utf8');
      cache={modified:stat.mtimeMs,code,key:crypto.createHash('sha256').update(code).digest('hex')};
    }
    return {enabled:true,key:cache.key,code:cache.code};
  });
}
module.exports={register};
