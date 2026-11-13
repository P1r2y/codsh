'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const {RolloutStore} = require('../src/rollout-store.cjs');
const {CACHE_NAME,ProjectCache} = require('../src/project-cache.cjs');

const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const timestamp = '2026-10-25T10:00:00.000Z';
const event = (type, payload) => ({timestamp, type, payload});
const msg = (type, payload = {}) => event('event_msg', {type, ...payload});
const tokens = (input, output) => ({input_tokens:input, cached_input_tokens:10, output_tokens:output, total_tokens:input+output});
const line = value => JSON.stringify(value) + '\n';

function setup(t, thread = id) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codsh-project-cache-'));
  t.after(() => fs.rmSync(base, {recursive:true, force:true}));
  const home = path.join(base, 'home'), project = path.join(base, 'project');
  const folder = path.join(home, 'sessions', '2026', '10', '25');
  fs.mkdirSync(folder, {recursive:true});
  fs.mkdirSync(project, {recursive:true});
  const filename = path.join(folder, `rollout-2026-10-25T10-00-00-${thread}.jsonl`);
  const events = [
    event('session_meta', {id:thread, cwd:project, base_instructions:'private conversation text'}),
    event('turn_context', {turn_id:'one', model:'test-model'}),
    msg('task_started', {turn_id:'one'}),
    event('token_usage_record', {turn_id:'one', response_id:'response-one', usage:tokens(100, 20)}),
    msg('task_complete', {turn_id:'one', duration_ms:3000})
  ];
  fs.writeFileSync(filename, events.map(line).join('') + line(event('response_item', {content:'private conversation text'})).repeat(3000));
  return {base, home, project, filename, cache:path.join(project, '.codex', CACHE_NAME), events};
}

test('项目缓存跨重启复用历史统计，不保存聊天正文，未变化时不重新扫描会话目录', async t => {
  const fixture = setup(t);
  const first = new RolloutStore(fixture.home);
  const original = await first.read(id);
  await first.projectCache.flush();
  const content = fs.readFileSync(fixture.cache, 'utf8');
  assert.ok(!content.includes('private conversation text'));
  assert.equal(JSON.parse(content).sessions[id].offset, fs.statSync(fixture.filename).size);

  let logOpens = 0, directoryReads = 0;
  const open = fsp.open.bind(fsp), readdir = fsp.readdir.bind(fsp);
  t.mock.method(fsp, 'open', async (...args) => {
    if (String(args[0]) === fixture.filename) logOpens++;
    return open(...args);
  });
  t.mock.method(fsp, 'readdir', async (...args) => { directoryReads++; return readdir(...args); });
  const second = new RolloutStore(fixture.home);
  const restored = await second.read(id);
  assert.equal(restored.total.total_tokens, original.total.total_tokens);
  assert.deepEqual(restored.turns, original.turns);
  assert.equal(logOpens, 1, 'only session metadata should be read from an unchanged historical log');
  const indexed = directoryReads;
  const unchanged = await second.read(id, {knownRevision:restored.revision});
  await second.read(id, {knownRevision:restored.revision});
  assert.equal(unchanged.unchanged, true);
  fs.appendFileSync(fixture.filename, line(event('response_item', {content:'new chat text'})));
  const textOnly = await second.read(id, {knownRevision:restored.revision});
  assert.equal(textOnly.unchanged, true, 'message text alone should not invalidate usage statistics');
  assert.equal(directoryReads, indexed, 'known conversations should not trigger repeated directory scans');
  assert.equal(logOpens, 2);
});

test('追加与跨 UTF-8 的半行可以从缓存断点继续，不重复计算旧响应', async t => {
  const fixture = setup(t);
  const duplicate = line(event('token_usage_record', {turn_id:'one', response_id:'response-one', usage:tokens(100, 20)}));
  const next = Buffer.from(line(event('token_usage_record', {turn_id:'one', response_id:'response-two', usage:tokens(40, 5), note:'中文'})));
  const split = next.indexOf(Buffer.from('中')) + 1;
  fs.appendFileSync(fixture.filename, duplicate);
  fs.appendFileSync(fixture.filename, next.subarray(0, split));
  const first = new RolloutStore(fixture.home);
  assert.equal((await first.read(id)).total.total_tokens, 120);
  await first.projectCache.flush();
  fs.appendFileSync(fixture.filename, next.subarray(split));

  const second = new RolloutStore(fixture.home);
  const restored = await second.read(id);
  assert.equal(restored.total.total_tokens, 165);
  assert.equal(restored.requests, 2);
  await second.projectCache.flush();
  const third = new RolloutStore(fixture.home);
  assert.equal((await third.read(id)).total.total_tokens, 165);
});

test('原日志同大小被改写或缓存损坏时重新读取，避免显示旧统计', async t => {
  const fixture = setup(t);
  const first = new RolloutStore(fixture.home);
  await first.read(id);
  await first.projectCache.flush();
  const original = fs.readFileSync(fixture.filename, 'utf8');
  const rewritten = original.replace('"input_tokens":100', '"input_tokens":200');
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(rewritten));
  fs.writeFileSync(fixture.filename, rewritten);
  const future = new Date(Date.now()+2000);
  fs.utimesSync(fixture.filename, future, future);
  const second = new RolloutStore(fixture.home);
  assert.equal((await second.read(id)).total.input_tokens, 200);
  await second.projectCache.flush();
  const damaged = JSON.parse(fs.readFileSync(fixture.cache, 'utf8'));
  damaged.sessions[id].state.total.input_tokens = 900;
  fs.writeFileSync(fixture.cache, JSON.stringify(damaged));
  const checked = new RolloutStore(fixture.home);
  assert.equal((await checked.read(id)).total.input_tokens, 200);
  fs.writeFileSync(fixture.cache, '{broken');
  const third = new RolloutStore(fixture.home);
  assert.equal((await third.read(id)).total.input_tokens, 200);
});

test('生成中正文持续追加时只返回轻量计时，新的用量记录仍触发刷新', async t => {
  const fixture = setup(t);
  fs.appendFileSync(fixture.filename, line(msg('task_started', {turn_id:'two'})) +
    line(event('token_usage_record', {turn_id:'two', response_id:'next', usage:tokens(30, 5)})));
  const store = new RolloutStore(fixture.home);
  const active = await store.read(id);
  fs.appendFileSync(fixture.filename, line(event('response_item', {content:'streamed message'})));
  const tick = await store.read(id, {knownRevision:active.revision});
  assert.equal(tick.unchanged, true);
  assert.equal(tick.liveTick.id, 'two');
  assert.equal(tick.turns, undefined);
  fs.appendFileSync(fixture.filename, line(event('token_usage_record', {turn_id:'two', response_id:'next2', usage:tokens(10, 2)})));
  const changed = await store.read(id, {knownRevision:active.revision});
  assert.notEqual(changed.revision, active.revision);
  assert.equal(changed.total.total_tokens, 167);
});

test('会话分别写入所属项目，并在归档移动后仍可找到日志', async t => {
  const fixture = setup(t);
  const other = path.join(fixture.base, 'other-project');
  fs.mkdirSync(other, {recursive:true});
  const otherFile = path.join(path.dirname(fixture.filename), `rollout-2026-10-25T10-00-01-${id2}.jsonl`);
  const store = new RolloutStore(fixture.home);
  await store.read(id);
  fs.writeFileSync(otherFile, line(event('session_meta', {id:id2, cwd:other})) +
    line(msg('task_started', {turn_id:'two'})) +
    line(event('token_usage_record', {turn_id:'two', response_id:'other', usage:tokens(30, 5)})));
  assert.equal((await store.read(id2)).total.total_tokens, 35);
  await store.projectCache.flush();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(fixture.cache, 'utf8')).sessions), [id]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(other, '.codex', CACHE_NAME), 'utf8')).sessions), [id2]);
  const archived = path.join(fixture.home, 'archived_sessions');
  fs.mkdirSync(archived, {recursive:true});
  fs.renameSync(fixture.filename, path.join(archived, path.basename(fixture.filename)));
  assert.equal((await store.read(id)).total.total_tokens, 120);
});

test('后台缓存有项目数和字节上限，历史条目不重复序列化',async t=>{
  const fixture=setup(t),store=new RolloutStore(fixture.home);
  const cache=new ProjectCache(fixture.home,10000,{maxProjects:2,maxMemoryBytes:4000});
  store.projectCache=cache;
  t.after(()=>cache.dispose());
  await store.read(id);await cache.flush();
  const first=await cache.request('stats');
  assert.equal(first.serializedEntries,1);
  fs.appendFileSync(fixture.filename,line(event('token_usage_record',{turn_id:'one',response_id:'two',usage:tokens(10,2)})));
  await store.read(id);await cache.flush();
  assert.equal((await cache.request('stats')).serializedEntries,2);
  for(let i=0;i<5;i++){
    const cwd=path.join(fixture.base,'project-'+i);fs.mkdirSync(cwd);
    await cache.restore(cwd,id,fixture.filename,fs.statSync(fixture.filename));
  }
  const bounded=await cache.request('stats');
  assert.ok(bounded.projects<=2);assert.ok(bounded.bytes<=4000);
  const restored=await cache.restore(fixture.project,id,fixture.filename,fs.statSync(fixture.filename));
  assert.equal(restored.acc.snapshot().total.total_tokens,132);
});

test('备用额度检查不重复打开未变化日志，并合并并发请求',async t=>{
  const fixture=setup(t),store=new RolloutStore(fixture.home);
  let opens=0;const open=fsp.open.bind(fsp);
  t.mock.method(fsp,'open',async(...args)=>{opens++;return open(...args);});
  await Promise.all([store.read(null),store.read(null)]);
  const initial=opens;assert.equal(initial,1);
  store.lastQuotaCheck=0;await store.read(null);assert.equal(opens,initial);
  fs.appendFileSync(fixture.filename,'\n');store.lastQuotaCheck=0;
  await store.read(null);assert.equal(opens,initial+1);
});
