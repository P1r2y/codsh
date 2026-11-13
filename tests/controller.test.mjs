import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationController } from '../src/ui/controller.mjs';
import { Lifetime } from '../src/ui/lifetime.mjs';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('切换会话立即清空，延迟返回不能覆盖新会话', async () => {
  const reads = [], changes = [];
  const controller = new ConversationController(id => new Promise(resolve => reads.push({id, resolve})), changed => changes.push(changed));
  controller.select(first);
  void controller.refresh();
  await tick();
  controller.select(second);
  assert.equal(controller.snapshot, null);
  void controller.refresh();
  reads[0].resolve({threadId:first, total:1});
  await tick();
  assert.equal(controller.snapshot, null);
  assert.equal(reads[1].id, second);
  reads[1].resolve({threadId:second, total:2});
  await tick();
  assert.equal(controller.snapshot.total, 2);
  assert.deepEqual(changes, [true, true, false]);
  controller.dispose();
});

test('快速往返仍拒绝旧版本请求，刷新合并为一次后续读取', async () => {
  const reads = [];
  const controller = new ConversationController(id => new Promise(resolve => reads.push({id, resolve})), () => {});
  controller.select(first); void controller.refresh(); await tick();
  controller.select(second); void controller.refresh();
  controller.select(first); void controller.refresh(); void controller.refresh();
  reads[0].resolve({threadId:first, obsolete:true}); await tick();
  assert.equal(controller.snapshot, null);
  assert.equal(reads.length, 3);
  assert.equal(reads[1].id, second);
  reads[2].resolve({threadId:first, fresh:true}); await tick();
  assert.equal(controller.snapshot.fresh, true);
  reads[1].resolve({threadId:second, obsolete:true}); await tick();
  assert.equal(controller.snapshot.fresh, true);
  controller.dispose();
});

test('返回已读会话即时复用数据，并且不等待另一会话的慢请求', async () => {
  const reads=[];
  const controller=new ConversationController(id=>new Promise(resolve=>reads.push({id,resolve})),()=>{});
  controller.select(first);const initial=controller.refresh();await tick();
  reads[0].resolve({threadId:first,revision:'one',total:10});await initial;
  controller.select(second);const slow=controller.refresh();await tick();
  controller.select(first);
  assert.equal(controller.snapshot.total,10);
  const back=controller.refresh();await tick();
  assert.equal(reads[2].id,first);
  reads[2].resolve({threadId:first,revision:'two',total:12});await back;
  reads[1].resolve({threadId:second,total:99});await slow;
  assert.equal(controller.snapshot.total,12);
  controller.select(null);await controller.refresh();
  assert.equal(reads.length,3);
  controller.dispose();assert.equal(controller.history.size,0);
});

test('销毁后忽略在途读取，事件和计时器统一释放', async () => {
  let resolve, updated = 0, events = 0;
  const controller = new ConversationController(() => new Promise(done => { resolve = done; }), () => updated++);
  controller.select(first); void controller.refresh(); await tick();
  controller.dispose(); resolve({threadId:first}); await tick();
  assert.equal(updated, 1); assert.equal(controller.snapshot, null);
  const lifetime = new Lifetime(), target = new EventTarget();
  lifetime.listen(target, 'example', () => events++);
  target.dispatchEvent(new Event('example'));
  let cleared = false;
  lifetime.own(() => { cleared = true; });
  lifetime.dispose(); lifetime.dispose();
  target.dispatchEvent(new Event('example'));
  assert.equal(events, 1); assert.equal(cleared, true);
});

test('合并刷新遇到读取失败时统一处理错误，并执行后续读取', async t => {
  t.mock.method(console, 'warn', () => {});
  let reject, calls = 0;
  const controller = new ConversationController(id => {
    if (++calls === 1) return new Promise((_, fail) => { reject = fail; });
    return {threadId:id};
  }, () => {});
  controller.select(first);
  const running = controller.refresh();
  await tick();
  const pending = controller.refresh();
  reject(new Error('测试读取失败'));
  await Promise.all([running, pending]);
  await tick();
  assert.equal(calls, 2);
  assert.equal(controller.snapshot.threadId, first);
  controller.dispose();
});

test('未变化的历史数据不触发重绘，运行中只更新计时', async () => {
  const requests = [], changes = [];
  const responses = [
    {threadId:first, revision:'v1', turns:[{id:'turn', completed:true}]},
    {threadId:first, revision:'v1', unchanged:true},
    {threadId:first, revision:'v2', turns:[{id:'turn', completed:false, durationMs:1000, averageTps:10}]},
    {threadId:first, revision:'v2', unchanged:true, liveTick:{id:'turn', durationMs:2000, averageTps:5}}
  ];
  const controller = new ConversationController((id, knownRevision) => {
    requests.push({id, knownRevision}); return responses.shift();
  }, (changed, liveOnly) => changes.push({changed, liveOnly}));
  controller.select(first);
  await controller.refresh();
  await controller.refresh();
  assert.equal(changes.length, 2);
  assert.equal(requests[1].knownRevision, 'v1');
  await controller.refresh();
  await controller.refresh();
  assert.deepEqual(changes.at(-1), {changed:false, liveOnly:true});
  assert.equal(controller.snapshot.turns[0].durationMs, 2000);
  assert.equal(controller.snapshot.turns[0].averageTps, 5);
  controller.dispose();
});
