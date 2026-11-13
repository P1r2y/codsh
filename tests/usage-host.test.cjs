'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const protocol=require('../src/protocol.cjs');

test('迟到的会话读取不抢回新会话监听，额度查询不切换监听',async()=>{
  const one='00000000-0000-4000-8000-000000000001',two='00000000-0000-4000-8000-000000000002';
  let finish;const selected=[],handlers=new Map();
  class Store {
    constructor(){this.files=new Map([[one,'one.jsonl'],[two,'two.jsonl']]);}
    read(id){return id===one?new Promise(done=>{finish=done;}):Promise.resolve({threadId:id});}
  }
  class Watches {select(_owner,id,file){selected.push({id,file});return Boolean(id);}dispose(){}}
  const app=new EventEmitter();
  const context={module:{exports:{}},process:{platform:'linux'},require:name=>{
    if(name==='./rollout-store.cjs')return {RolloutStore:Store};
    if(name==='./log-watch.cjs')return {LogWatchSet:Watches};
    if(name==='./protocol.cjs')return protocol;
    if(name==='electron')return {app,ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},nativeTheme:{}};
    return require(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/usage-host.cjs'),'utf8'),context);
  context.module.exports.register();
  const handler=handlers.get(protocol.READ_CHANNEL),event={senderFrame:{url:'app://-/index.html'},sender:{}};
  const old=handler(event,{threadId:one});
  await handler(event,{threadId:two});
  finish({threadId:one});await old;
  await handler(event,{threadId:null,quotaOnly:true});
  assert.deepEqual(selected,[{id:two,file:'two.jsonl'}]);
});
