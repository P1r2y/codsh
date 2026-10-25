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
  assert.equal(reads.length, 2);
  reads[1].resolve({threadId:first, fresh:true}); await tick();
  assert.equal(controller.snapshot.fresh, true);
  assert.equal(reads.length, 2);
  controller.dispose();
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
