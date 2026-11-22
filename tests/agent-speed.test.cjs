'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {AgentSpeed} = require('../src/agent-speed.cjs');
const {WorkerClient} = require('../src/worker-client.cjs');
const {RolloutStore} = require('../src/rollout-store.cjs');

test('Agent Speed supplies only this log’s measured rate and never changes token counts',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'codsh-speed-'));
  const directory=path.join(home,'sessions'), database=path.join(home,'history.sqlite');
  const id='00000000-0000-4000-8000-000000000001';
  const filename=path.join(directory,'rollout-test-'+id+'.jsonl');
  fs.mkdirSync(directory);
  fs.writeFileSync(filename,JSON.stringify({type:'token_usage_record',payload:{turn_id:'one',response_id:'one',
    usage:{input_tokens:100,cached_input_tokens:40,output_tokens:10,total_tokens:110}}})+'\n');
  const stat=fs.statSync(filename);
  const db=new DatabaseSync(database);
  db.exec('CREATE TABLE files(id INTEGER PRIMARY KEY,path TEXT UNIQUE,family TEXT,size INTEGER,modified INTEGER);'+
    'CREATE TABLE contributions(file_id INTEGER,source TEXT,measured_output INTEGER,measured_ms INTEGER);');
  const ticks=BigInt(Math.floor(stat.mtimeMs))*10000n+621355968000000000n;
  db.prepare('INSERT INTO files VALUES(1,?,?,?,?)').run(filename,'Codex',stat.size,ticks);
  db.exec("INSERT INTO contributions VALUES(1,'codex',20,1000),(1,'codex',100,3000),(1,'other',9999,1),(2,'codex',9999,1)");
  const reader=new WorkerClient(path.resolve(__dirname,'../src/usage-worker.cjs'),{home,database});
  t.after(async()=>{await reader.dispose();db.close();fs.rmSync(home,{recursive:true,force:true});});
  const source=new AgentSpeed(database),store=new RolloutStore(home,source);
  store.index=()=>assert.fail('indexed session triggered a directory crawl');
  assert.equal(await store.find(id),filename);
  assert.equal(source.find(path.join(home,'other-profile'),id),null);
  const {snapshot}=await reader.request('read',{threadId:id});
  assert.equal(snapshot.total.total_tokens,110);
  assert.equal(snapshot.agentSpeedTps,30);
  assert.equal(snapshot.turns[0].agentSpeedTps,undefined);
  const unchanged=await reader.request('read',{threadId:id,knownRevision:snapshot.revision});
  assert.equal(unchanged.snapshot.unchanged,true);
  db.exec('UPDATE files SET modified=modified-10000');
  assert.equal(source.measuredSpeed(filename,stat),null);
  fs.appendFileSync(filename,'\n');
  const stale=await reader.request('read',{threadId:id,knownRevision:snapshot.revision});
  assert.equal(stale.snapshot.agentSpeedTps,null);
  assert.equal(stale.snapshot.total.total_tokens,110);
  const missing=path.join(home,'not-installed.sqlite');
  assert.equal(new AgentSpeed(missing).measuredSpeed(filename,stat),null);
  assert.equal(fs.existsSync(missing),false);
});
