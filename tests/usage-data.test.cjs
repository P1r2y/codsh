'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {UsageAccumulator,normalizeLimits,unionDuration} = require('../src/usage-data.cjs');
const {RolloutStore} = require('../src/rollout-store.cjs');
const id='00000000-0000-4000-8000-000000000001';
const event=(type,payload)=>({timestamp:'2026-10-24T17:10:40Z',type,payload});
const msg=(type,extra={})=>event('event_msg',{type,...extra});
const tokens=(input,cache,output)=>({input_tokens:input,cached_input_tokens:cache,output_tokens:output,total_tokens:input+output});
test('真实计数：缓存包含在输入中，响应去重，每轮独立累计',()=>{
  const a=new UsageAccumulator();
  a.feed(msg('task_started',{turn_id:'first',started_at:1792861840}));
  const record=event('token_usage_record',{turn_id:'first',response_id:'one',usage:tokens(100,80,20),thread_token_usage:tokens(100,80,20)});
  a.feed(record);a.feed(record);
  a.feed(msg('token_count',{info:{total_token_usage:tokens(100,80,20),last_token_usage:tokens(100,80,20),model_context_window:1000}}));
  a.feed(msg('task_complete',{turn_id:'first',duration_ms:10000,completed_at:1792861850}));
  a.feed(msg('task_started',{turn_id:'second',started_at:1792861860}));
  a.feed(event('token_usage_record',{turn_id:'second',response_id:'two',usage:tokens(200,100,30),thread_token_usage:tokens(300,180,50)}));
  const s=a.snapshot();
  assert.equal(s.total.total_tokens,350);assert.equal(s.requests,2);assert.equal(s.cacheHitPercent,60);
  assert.equal(s.turns[0].usage.total_tokens,120);assert.equal(s.turns[0].cacheHitPercent,80);
  assert.equal(s.turns[1].usage.total_tokens,230);assert.equal(s.contextPercent,12);
  assert.equal(s.turns[0].averageTps,2);
});
test('旧日志的累计差分、重复 token_count、不虚构缺失速度',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  const count=msg('token_count',{info:{total_token_usage:tokens(100,50,20)}});
  a.feed(count);a.feed(count);
  a.feed(msg('task_started',{turn_id:'two'}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(180,110,40)}}));
  const s=a.snapshot();assert.equal(s.requests,2);assert.equal(s.turns[1].usage.total_tokens,100);
  assert.equal(s.turns[0].estimatedGenerationTps,null);assert.equal(s.contextPercent,null);
});

test('逐次模型归集：切换模型、显式模型、重复响应和旧快照不改变已记录用量',()=>{
  const a=new UsageAccumulator();
  a.feed(msg('task_started',{turn_id:'first'}));
  a.feed(event('turn_context',{turn_id:'first',model:'gpt-6.1-sol'}));
  a.feed(event('token_usage_record',{turn_id:'first',response_id:'one',usage:tokens(100,80,20),thread_token_usage:tokens(100,80,20)}));
  a.feed(event('turn_context',{turn_id:'first',model:'gpt-6-astra'}));
  a.feed(event('token_usage_record',{turn_id:'first',response_id:'two',usage:tokens(200,100,30),thread_token_usage:tokens(300,180,50)}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(250,160,40)}}));
  a.feed(msg('task_started',{turn_id:'second'}));
  a.feed(event('token_usage_record',{turn_id:'second',response_id:'three',model:'gpt-6.1-sol',usage:tokens(50,20,10),thread_token_usage:tokens(350,200,60)}));
  a.feed(event('token_usage_record',{turn_id:'second',response_id:'one',usage:tokens(100,80,20)}));
  const s=a.snapshot(),models=new Map(s.models.map(m=>[m.model,m]));
  assert.equal(s.total.total_tokens,410);assert.equal(s.requests,3);
  assert.equal(models.get('gpt-6.1-sol').usage.total_tokens,180);
  assert.equal(models.get('gpt-6.1-sol').cacheHitPercent,100*100/150);
  assert.equal(models.get('gpt-6-astra').usage.total_tokens,230);
  for(const key of Object.keys(s.total))assert.equal(s.models.reduce((sum,m)=>sum+m.usage[key],0),s.total[key]);
  assert.equal(s.turns[0].models.length,2);assert.equal(s.turns[1].models[0].model,'gpt-6.1-sol');
});

test('旧格式按每次累计增量归属模型，缓存只计入输入一次',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6.1-sol'}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(100,80,20)}}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6-astra'}));
  const count=msg('token_count',{info:{total_token_usage:tokens(200,120,40),last_token_usage:tokens(10,5,2)}});
  a.feed(count);a.feed(count);
  const s=a.snapshot();
  assert.equal(s.total.total_tokens,240);assert.equal(s.models.length,2);assert.equal(s.requests,2);
  assert.deepEqual(s.models.map(m=>m.usage.total_tokens),[120,120]);
  assert.equal(s.models.find(m=>m.model==='gpt-6-astra').usage.cached_input_tokens,40);
  assert.equal(s.models.reduce((sum,m)=>sum+m.usage.input_tokens+m.usage.output_tokens,0),240);
});

test('缺失模型保持未知，缺失历史计数不冒充当前模型',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'unknown',usage:tokens(100,50,20)}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6.1-sol'}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'known',usage:tokens(50,25,10),thread_token_usage:tokens(350,175,70)}));
  const s=a.snapshot(),unknown=s.models.find(m=>m.model===null);
  assert.equal(s.available,true);assert.equal(s.total.total_tokens,420);
  assert.equal(unknown.usage.total_tokens,360);
  assert.equal(s.models.find(m=>m.model==='gpt-6.1-sol').usage.total_tokens,60);
  assert.equal(s.models.reduce((sum,m)=>sum+m.usage.total_tokens,0),s.total.total_tokens);
});

test('先收到累计快照再收到同轮响应时不重复计数',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6.1-sol'}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(100,50,20)}}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'one',usage:tokens(100,50,20),thread_token_usage:tokens(100,50,20)}));
  const s=a.snapshot();assert.equal(s.requests,1);assert.equal(s.models.length,1);assert.equal(s.total.total_tokens,120);
});

test('上下文记录不产生空轮次，迟到响应沿用所属轮次的模型',()=>{
  const a=new UsageAccumulator();
  a.feed(event('turn_context',{turn_id:'first',model:'gpt-6-astra'}));
  assert.equal(a.snapshot().turnCount,0);
  a.feed(msg('task_started',{turn_id:'first'}));
  a.feed(msg('task_started',{turn_id:'second'}));
  a.feed(event('turn_context',{turn_id:'second',model:'gpt-6.1-sol'}));
  a.feed(event('token_usage_record',{turn_id:'first',response_id:'late',usage:tokens(100,50,20)}));
  const s=a.snapshot();assert.equal(s.available,true);assert.equal(s.turnCount,2);
  assert.equal(s.models[0].model,'gpt-6-astra');assert.equal(s.total.total_tokens,120);
});

test('旧累计回退不产生负用量或空请求，模型合计与本轮一致',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6.1-sol'}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(100,50,20)}}));
  a.feed(event('turn_context',{turn_id:'one',model:'gpt-6-astra'}));
  a.feed(msg('token_count',{info:{total_token_usage:tokens(80,40,10)}}));
  const s=a.snapshot();assert.equal(s.requests,1);assert.equal(s.models.length,1);
  assert.equal(s.models[0].usage.total_tokens,s.turns[0].usage.total_tokens);
  assert.equal(s.total.total_tokens,120);
});
test('生成区间合并，工具耗时不冒充生成耗时',()=>{
  assert.equal(unionDuration([[100,200],[150,300],[500,600]]),300);
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'Reasoning',id:'r1'},started_at_ms:1000,completed_at_ms:1200}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'AgentMessage',id:'m1'},started_at_ms:1100,completed_at_ms:1400}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'CommandExecution',id:'c1'},started_at_ms:1500,completed_at_ms:8000}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'r',usage:tokens(100,50,20)}));
  assert.equal(a.snapshot().turns[0].estimatedGenerationTps,50);
  assert.equal(a.snapshot().turns[0].tools,1);
});

test('缺少结束事件的旧轮次冻结在最后记录，不再累加过夜空闲',()=>{
  const a=new UsageAccumulator();
  a.feed(event('event_msg',{type:'task_started',turn_id:'old',started_at:1792861840}));
  a.feed({...event('token_usage_record',{turn_id:'old',response_id:'r',usage:tokens(100,50,20)}),timestamp:'2026-10-24T17:10:42Z'});
  a.feed({...msg('task_started',{turn_id:'new',started_at:1792900000}),timestamp:new Date(1792900000000).toISOString()});
  const old=a.snapshot(1792999999999).turns[0];
  assert.equal(old.completed,true);assert.equal(old.endInferred,true);assert.equal(old.durationMs,2000);
  assert.equal(old.status,'已结束（记录不完整）');
});

test('零长度推理计时不除以整轮全部输出，保留明确的整轮平均',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'Reasoning',id:'r1'},started_at_ms:1000,completed_at_ms:1000}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'AgentMessage',id:'m1'},started_at_ms:2000,completed_at_ms:2500}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'r',usage:{...tokens(1000,500,3000),reasoning_output_tokens:2900}}));
  a.feed(msg('task_complete',{turn_id:'one',duration_ms:100000}));
  const t=a.snapshot().turns[0];
  assert.equal(t.generationTimingComplete,false);assert.equal(t.generatedMs,null);
  assert.equal(t.estimatedGenerationTps,null);assert.equal(t.averageTps,30);
});

test('各响应计时必须完整配对，未收到用量的生成区间不影响上次速度',()=>{
  const a=new UsageAccumulator();a.feed(msg('task_started',{turn_id:'one'}));
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'Reasoning',id:'r1'},started_at_ms:1000,completed_at_ms:3000}));
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'first',usage:{...tokens(1000,500,200),reasoning_output_tokens:100}}));
  assert.equal(a.snapshot().turns[0].estimatedGenerationTps,100);
  a.feed(msg('item_completed',{turn_id:'one',item:{type:'Reasoning',id:'r2'},started_at_ms:4000,completed_at_ms:104000}));
  assert.equal(a.snapshot().turns[0].estimatedGenerationTps,100);
  a.feed(event('token_usage_record',{turn_id:'one',response_id:'second',usage:{...tokens(1000,500,1000),reasoning_output_tokens:500}}));
  assert.equal(a.snapshot().turns[0].estimatedGenerationTps,1200*1000/102000);
});
test('额度字段兼容：仅周额度、多个桶、缺失值、百分比边界',()=>{
  const s=normalizeLimits({rateLimitsByLimitId:{codex:{primary:{usedPercent:44,windowDurationMins:10080,resetsAt:1793384117},secondary:null}}},123);
  assert.equal(s.groups[0].windows.length,1);assert.equal(s.groups[0].windows[0].remainingPercent,56);
  assert.equal(s.groups[0].windows[0].resetsAt,1793384117000);assert.equal(s.observedAt,123);
  assert.equal(normalizeLimits({primary:{usedPercent:null,windowDurationMins:300}}),null);
  assert.equal(normalizeLimits({primary:{used_percent:110,window_minutes:300,resets_at:null}}).groups[0].windows[0].remainingPercent,0);
});
test('增量读取跨 UTF-8 字节和半行、会话隔离、拒绝路径输入',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'codex-usage-test-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const dir=path.join(home,'sessions','2026','10','25');fs.mkdirSync(dir,{recursive:true});
  const filename=path.join(dir,`rollout-2026-10-25T01-00-00-${id}.jsonl`);
  fs.writeFileSync(filename,JSON.stringify(msg('task_started',{turn_id:'one'}))+'\n');
  const store=new RolloutStore(home);await store.read(id);
  const line=Buffer.from(JSON.stringify(msg('token_count',{comment:'中文',info:{total_token_usage:tokens(100,75,10)}}))+'\n');
  const split=line.indexOf(Buffer.from('中'))+1;
  fs.appendFileSync(filename,line.subarray(0,split));assert.equal((await store.read(id)).available,false);
  fs.appendFileSync(filename,line.subarray(split));assert.equal((await store.read(id)).total.total_tokens,110);
  assert.equal((await store.read('00000000-0000-0000-0000-000000000000')).available,false);
  await assert.rejects(store.read('../auth.json'),/无效/);
});
