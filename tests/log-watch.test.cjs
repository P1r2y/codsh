'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LogWatchSet}=require('../src/log-watch.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('日志不变化时不通知，连续写入合并，切换和销毁释放监听',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codsh-watch-'));
  const first=path.join(dir,'first'),second=path.join(dir,'second');
  fs.writeFileSync(first,'');fs.writeFileSync(second,'');
  const owner=Object.assign(new EventEmitter(),{id:1,isDestroyed:()=>false}),events=[];
  const watches=new LogWatchSet((_owner,message)=>events.push(message),30);
  t.after(()=>{watches.dispose();fs.rmSync(dir,{recursive:true,force:true});});
  assert.equal(watches.select(owner,'one',first),true);
  await delay(80);assert.equal(events.length,0);
  fs.appendFileSync(first,'a');fs.appendFileSync(first,'b');
  await delay(120);assert.deepEqual(events,[{threadId:'one',watching:true}]);
  watches.select(owner,'two',second);fs.appendFileSync(first,'c');
  await delay(80);assert.equal(events.length,1);
  fs.appendFileSync(second,'a');await delay(120);
  assert.equal(events.at(-1).threadId,'two');assert.equal(owner.listenerCount('destroyed'),1);
  owner.emit('destroyed');assert.equal(watches.records.size,0);
  fs.appendFileSync(second,'b');await delay(80);assert.equal(events.length,2);
  owner.isDestroyed=()=>true;assert.equal(watches.select(owner,'one',first),false);
});
