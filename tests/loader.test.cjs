const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
for(const versioned of [false,true]) test(`加载器：${versioned?'版本运行时':'旧安装'}、开关、热重载和来源限制`,t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'codex-plugin-loader-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const plugin=path.join(base,'plugins/codex-usage');fs.mkdirSync(path.join(plugin,'ui'),{recursive:true});
 fs.writeFileSync(path.join(plugin,'plugin.json'),JSON.stringify({host:'lib/usage-host.cjs',preload:'ui/usage-preload.cjs'}));
 const config=path.join(base,'plugins.json'),ui=path.join(plugin,'ui/usage-preload.cjs');
 fs.writeFileSync(config,'\uFEFF'+JSON.stringify({plugins:{'codex-usage':{enabled:true}}}));fs.writeFileSync(ui,'window.first=true');
 const resourcesPath=path.join(base,versioned?'runtimes/client-id/app/resources':'app/resources');
 if(versioned){fs.mkdirSync(resourcesPath,{recursive:true});fs.writeFileSync(path.join(resourcesPath,'codsh-loader.json'),JSON.stringify({base:path.relative(resourcesPath,base)}));}
 const handlers=new Map();let hostOptions;
 const context={module:{exports:{}},process:{resourcesPath},require:name=>{
   if(name==='electron')return {ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
   if(name===path.join(plugin,'lib/usage-host.cjs'))return {register:options=>{hostOptions=options}};
   if(name==='./protocol.cjs')return require('../src/protocol.cjs');
   return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/enhancement-loader.cjs'),'utf8'),context);
 context.module.exports.register();
 const read=handlers.get('codex-enhancement-loader:state-v1'),event={senderFrame:{url:'app://-/index.html'}};
 assert.equal(hostOptions.isEnabled(),true);const one=read(event);assert.equal(one.code,'window.first=true');
 fs.writeFileSync(config,JSON.stringify({plugins:{'codex-usage':{enabled:false}}}));assert.equal(read(event).enabled,false);assert.equal(hostOptions.isEnabled(),false);
 fs.writeFileSync(config,JSON.stringify({plugins:{'codex-usage':{enabled:true}}}));
 fs.writeFileSync(ui,'window.second=true');fs.utimesSync(ui,new Date(),new Date(Date.now()+1000));
 const two=read(event);assert.notEqual(one.key,two.key);assert.equal(two.code,'window.second=true');
 assert.equal(read({senderFrame:{url:'https://example.com'}}).enabled,false);
});
