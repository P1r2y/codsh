const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usageParts } = require('../src/usage-model.cjs');

test('共享用量分类保留未知计数，不伪造缓存或输出', () => {
  const missing = usageParts({input_tokens:0,cached_input_tokens:0,output_tokens:0,total_tokens:68597});
  assert.equal(missing.find(part => part.key === 'unknown').amount, 68597);
  assert.ok(missing.filter(part => part.key !== 'unknown').every(part => part.amount === null));
  const known = usageParts({input_tokens:100,cached_input_tokens:80,output_tokens:5,total_tokens:105});
  assert.equal(known.reduce((sum, part) => sum + part.amount, 0), 105);
  assert.equal(known.length, 3);
});
