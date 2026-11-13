import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundScan} from '../src/ui/background-scan.mjs';

test('历史扫描每批最多八项，批间留出空闲时间',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const scan=new BackgroundScan({now:()=>Date.now()}),seen=[];
  scan.request(function*(){for(let i=0;i<20;i++){seen.push(i);yield;}});
  t.mock.timers.tick(0);assert.equal(seen.length,8);
  t.mock.timers.tick(47);assert.equal(seen.length,8);
  t.mock.timers.tick(1);assert.equal(seen.length,16);
  t.mock.timers.tick(48);assert.equal(seen.length,20);
  scan.dispose();
});

test('重复请求合并，持续变化不打断正在完成的扫描',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const scan=new BackgroundScan({now:()=>Date.now()}),seen=[];
  scan.request(function*(){for(let i=0;i<12;i++){seen.push(i);yield;}});
  t.mock.timers.tick(0);
  scan.request(function*(){seen.push('obsolete');});
  scan.request(function*(){seen.push('latest');});
  t.mock.timers.tick(48);assert.deepEqual(seen,Array.from({length:12},(_,i)=>i));
  t.mock.timers.tick(1151);assert.equal(seen.length,12);
  t.mock.timers.tick(1);assert.equal(seen.at(-1),'latest');
  assert.equal(seen.includes('obsolete'),false);scan.dispose();
});

test('单项处理变慢时提前结束本批，避免一次做满八项',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  let elapsed=0,processed=0;
  const scan=new BackgroundScan({now:()=>elapsed});
  scan.request(function*(){for(let i=0;i<10;i++){elapsed+=2;processed++;yield;}});
  t.mock.timers.tick(0);assert.equal(processed,2);
  t.mock.timers.tick(48);assert.equal(processed,4);
  scan.dispose();
});

test('切换和停用取消剩余工作，新的对话可立即开始',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const scan=new BackgroundScan({now:()=>Date.now()}),seen=[];
  scan.request(function*(){for(let i=0;i<100;i++){seen.push('old');yield;}});
  t.mock.timers.tick(0);scan.cancel();
  scan.request(function*(){seen.push('new');yield;seen.push('late');});
  t.mock.timers.tick(0);assert.equal(seen.filter(v=>v==='old').length,8);
  assert.ok(seen.includes('new'));
  scan.dispose();const length=seen.length;
  scan.request(function*(){seen.push('disposed');});
  t.mock.timers.tick(5000);assert.equal(seen.length,length);
});
