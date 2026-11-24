import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundScan} from '../src/ui/background-scan.mjs';

test('滚入阅读区域的统计优先执行，连续可见事件只安排一次', t => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const scan=new BackgroundScan({now:()=>Date.now()});
  const calls=[];
  scan.request(function*(){calls.push('first');});
  t.mock.timers.tick(0);
  scan.request(function*(){calls.push('stale');});
  scan.request(function*(){calls.push('visible');},true);
  scan.request(function*(){calls.push('latest');},true);
  t.mock.timers.tick(0);
  assert.deepEqual(calls,['first','latest']);
  scan.dispose();
  t.mock.timers.tick(1500);
  assert.equal(calls.length,2);
});

test('每批先完成全部布局读取，再挂载回复，最后清理已移除的行', t => {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:0});
  const scan = new BackgroundScan({batchSize:2, now:() => Date.now()});
  const events = [];
  scan.request(function* () {
    for (const id of ['a', 'b', 'c']) {
      events.push('read ' + id);
      yield () => events.push('mount ' + id);
    }
    return () => events.push('cleanup');
  });
  t.mock.timers.tick(0);
  assert.deepEqual(events, ['read a', 'read b', 'mount a', 'mount b']);
  t.mock.timers.tick(48);
  assert.deepEqual(events.slice(4), ['read c', 'mount c', 'cleanup']);
  scan.dispose();
});

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

test('耗时的挂载也受时间预算限制，取消会丢弃待挂载的行', t => {
  t.mock.timers.enable({apis:['setTimeout','Date'], now:0});
  let clock = 0;
  const scan = new BackgroundScan({now:() => clock});
  const mounted = [];
  scan.request(function* () {
    for (let id = 0; id < 6; id++) {
      yield deferred => { mounted.push([id, deferred]); clock += 2; };
    }
  });
  t.mock.timers.tick(0);
  assert.deepEqual(mounted, [[0,false],[1,false]]);
  t.mock.timers.tick(48);
  assert.deepEqual(mounted.slice(2), [[2,true],[3,true]]);
  scan.cancel();
  t.mock.timers.tick(1000);
  assert.equal(mounted.length, 4);
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
