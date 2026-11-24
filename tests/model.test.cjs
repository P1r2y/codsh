const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usageParts } = require('../src/usage-model.cjs');

test('实时速度时钟复用历史统计，只更新正在生成的一轮', async () => {
  const {sessionSpeedReader} = await import('../src/ui/format.mjs');
  let reads=0;
  const saved={completed:true, usage:{output_tokens:100}, get durationMs() { reads++; return 2000; }};
  const live={completed:false, usage:{output_tokens:200}, durationMs:1000};
  const speed=sessionSpeedReader([saved,live]);
  const initialReads=reads;
  assert.equal(speed(),'整轮 100.0 tok/s');
  live.durationMs=4000;
  assert.equal(speed(),'整轮 50.0 tok/s');
  assert.equal(reads,initialReads);
  assert.equal(sessionSpeedReader([{...saved,durationMs:null},live])(),'速度 —');
  const measured=sessionSpeedReader([{...live,generatedMs:1000,estimatedGenerationTps:200}]);
  assert.equal(measured(),'200 tok/s');
});

test('共享用量分类保留未知计数，不伪造缓存或输出', () => {
  const missing = usageParts({input_tokens:0,cached_input_tokens:0,output_tokens:0,total_tokens:68597});
  assert.equal(missing.find(part => part.key === 'unknown').amount, 68597);
  assert.ok(missing.filter(part => part.key !== 'unknown').every(part => part.amount === null));
  const known = usageParts({input_tokens:100,cached_input_tokens:80,output_tokens:5,total_tokens:105});
  assert.equal(known.reduce((sum, part) => sum + part.amount, 0), 105);
  assert.equal(known.length, 3);
});
