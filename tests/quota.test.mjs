import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { QuotaController } from '../src/ui/quota-controller.mjs';
import quotaModel from '../src/quota-model.cjs';
import protocol from '../src/protocol.cjs';

const now = 1800000000000;
const raw = used => ({rateLimits:{primary:{usedPercent:used,windowDurationMins:10080,resetsAt:now/1000+604800}}});
const normalized = used => quotaModel.normalizeLimits(raw(used), now);
const notification = value => ({type:'mcp-notification',hostId:'local',method:'account/rateLimits/updated',params:value});
const remaining = controller => controller.limits?.groups[0].windows[0].remainingPercent;

test('原生额度重置为零后，旧会话和后来的日志快照均不能覆盖', () => {
  const ipc = new EventEmitter();
  let changed = 0;
  const controller = new QuotaController(ipc, () => changed++, () => now);
  controller.useFallback(normalized(92));
  assert.equal(remaining(controller), 8);
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, {type:'mcp-response',hostId:'local',message:{id:'native-read',result:raw(0)}});
  assert.equal(remaining(controller), 100);
  controller.useFallback({...normalized(92),observedAt:now+86400000});
  assert.equal(remaining(controller), 100);
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, notification(raw(3)));
  assert.equal(remaining(controller), 97);
  assert.equal(changed, 2);
  controller.dispose();
});

test('全局额度独立刷新，合并并发读取并限制轮询频率', async () => {
  const ipc = new EventEmitter();
  let clock = now, requests = [], resolve;
  ipc.invoke = (channel, request) => {
    requests.push({channel, request});
    return new Promise(done => { resolve = done; });
  };
  const controller = new QuotaController(ipc, () => {}, () => clock);
  const first = controller.refresh();
  await controller.refresh(); await controller.refresh(true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {channel:protocol.READ_CHANNEL,request:{threadId:null}});
  resolve({limits:normalized(92)}); await first;
  assert.equal(remaining(controller), 8);
  await controller.refresh(); assert.equal(requests.length, 1);
  clock += 30001;
  const second = controller.refresh();
  resolve({limits:{...normalized(0),observedAt:clock}}); await second;
  assert.equal(remaining(controller), 100);
  controller.dispose();
});

test('账户变化清除旧额度，忽略远程主机、错误响应和销毁后的数据', async () => {
  const ipc = new EventEmitter();
  let resolve, changed = 0;
  ipc.invoke = () => new Promise(done => { resolve = done; });
  const controller = new QuotaController(ipc, () => changed++, () => now);
  controller.useFallback(normalized(92));
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, {...notification(raw(0)),hostId:'remote'});
  assert.equal(remaining(controller), 8);
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, {type:'mcp-response',hostId:'local',message:{error:{message:'unavailable'},result:raw(0)}});
  assert.equal(remaining(controller), 8);
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, {type:'mcp-notification',hostId:'local',method:'account/updated'});
  controller.useFallback(normalized(92)); assert.equal(controller.limits, null);
  ipc.emit(protocol.NATIVE_FROM_VIEW, {}, notification(raw(0)));
  assert.equal(remaining(controller), 100);
  const pending = controller.refresh();
  assert.equal(ipc.listenerCount(protocol.NATIVE_FROM_VIEW), 1);
  controller.dispose(); controller.dispose();
  resolve({limits:normalized(99)}); await pending;
  assert.equal(ipc.listenerCount(protocol.NATIVE_FROM_VIEW), 0);
  assert.equal(changed, 2); assert.equal(controller.limits, null);
});

test('过期的低额度窗口不遮盖仍有效的额度窗口', () => {
  const limits = normalized(100);
  limits.groups[0].windows[0].resetsAt = now-1;
  limits.groups[0].windows.push({kind:'secondary',remainingPercent:80,windowMinutes:300,resetsAt:now+60000});
  assert.equal(quotaModel.quotaWindow(limits, now).remainingPercent, 80);
});
