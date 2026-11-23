import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReplyCache} from '../src/ui/reply-cache.mjs';

test('首次访问分批发现回复，切走再返回从原位置继续，最近六个对话复用索引', t => {
  const ids = Array.from({length:7}, (_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
  const turns = ['one', 'two', 'three'].map(id => ({id, completed:false}));
  const rows = turns.map(turn => ({
    isConnected:true, dataset:{responseAnnotationConversation:ids[0]},
    closest:() => ({getAttribute:() => turn.id})
  }));
  let queries = 0;
  globalThis.document = {querySelectorAll(selector) {
    queries++;
    return selector.includes(ids[0]) ? rows : [];
  }};
  t.after(() => { delete globalThis.document; });
  const cache = new ReplyCache();
  t.after(() => cache.dispose());
  const snapshot = {turns};
  const first = cache.select(ids[0], snapshot);
  assert.equal(queries, 0);
  const job = first.changes();
  assert.equal(job.next().value.key, 'three');
  job.return();
  cache.select(ids[1], snapshot);
  assert.equal(cache.select(ids[0], snapshot), first);
  first.restore();
  assert.deepEqual([...first.changes()].map(change => change.key), ['two', 'one', 'three']);
  assert.equal(queries, 1);
  assert.deepEqual([...first.changes()], []);
  let disposed = 0;
  first.groups.set('one', {dispose() { disposed++; }});
  for (const id of ids.slice(1,6)) cache.select(id, snapshot);
  assert.equal(disposed, 0);
  cache.select(ids[6], snapshot);
  assert.equal(disposed, 1);
  const evicted = cache.select(ids[0], snapshot);
  assert.notEqual(evicted, first);
  assert.equal([...evicted.changes()].length, 3);
  assert.equal(queries, 2);
});
