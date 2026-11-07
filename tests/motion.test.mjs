import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricMotion, numericParts, numericTransition } from '../src/ui/motion.mjs';

test('数字递变保留文字、精度和分组，只更新变化的数值', () => {
  assert.deepEqual(numericParts('当前 44.8 tok/s'), ['当前 ', '44.8', ' tok/s']);
  const [speed] = numericTransition('当前 44.8 tok/s', '当前 46.8 tok/s');
  assert.equal(speed.from, 44.8);
  assert.equal(speed.to, 46.8);
  assert.equal(speed.format(45.8), '45.8');
  assert.equal(speed.format(46), '46.0');
  const [tokens] = numericTransition('1,234,567 tok · 缓存 99%', '1,234,777 tok · 缓存 99%');
  assert.equal(tokens.format(1234672), '1,234,672');
  assert.equal(tokens.target, '1,234,777');
  assert.deepEqual(numericTransition('当前 44.8 tok/s', '当前 44.8 tok/s'), []);
});

test('格式、位数和未知状态变化直接更新，不滚动单位或挤动文字', () => {
  for (const [before, after] of [
    ['909K tok', '1.0M tok'], ['当前 9.9 tok/s', '当前 10.1 tok/s'],
    ['当前 44.8 tok/s', '当前 44.80 tok/s'], ['速度 —', '当前 44.8 tok/s'],
    ['999,999 tok', '1,000,000 tok']
  ]) assert.deepEqual(numericTransition(before, after), []);
});

function motionClock(run) {
  const names=['document','matchMedia','requestAnimationFrame','cancelAnimationFrame'];
  const originals=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const frames=new Map();let sequence=0,preference;
  const media={matches:false,addEventListener:(_type,fn)=>{preference=fn;},removeEventListener:()=>{}};
  const node=(value='')=>({dataset:{},isConnected:true,nodes:[],value,
    get textContent(){return this.nodes.length?this.nodes.map(child=>child.textContent).join(''):this.value;},
    set textContent(text){this.nodes=[];this.value=text;},replaceChildren(...children){this.nodes=children;}});
  globalThis.document={createTextNode:node,createElement:()=>node()};
  globalThis.matchMedia=()=>media;
  globalThis.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const label=node('当前 62.5 tok/s'),motion=new MetricMotion(node());
  const step=now=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));};
  try { run({label,motion,step,frames,reduce:()=>{media.matches=true;preference();}}); }
  finally {
    motion.dispose();
    names.forEach((name,index)=>{if(originals[index])Object.defineProperty(globalThis,name,originals[index]);else delete globalThis[name];});
  }
}

test('受控帧时钟下数字连续递变，首帧延迟不跳过动画，完成后停止请求帧', () => {
  motionClock(({label,motion,step,frames})=>{
    motion.text(label,'当前 62.5 tok/s');motion.text(label,'当前 44.8 tok/s');
    const samples=[];
    for(let time=100000;time<=100240;time+=16){step(time);samples.push(Number(label.nodes[1].textContent));}
    assert.equal(samples[0],62.5);
    assert.equal(samples.at(-1),44.8);
    assert.ok(samples.filter(value=>value>44.8&&value<62.5).length>5);
    assert.ok(samples.every((value,index)=>index===0||value<=samples[index-1]));
    assert.equal(label.textContent,'当前 44.8 tok/s');
    assert.equal(frames.size,0);assert.equal(motion.numbers.size,0);
  });
});

test('数字更新被打断时从当前值继续，减少动态效果会立即落到真实目标值', () => {
  motionClock(({label,motion,step,frames,reduce})=>{
    motion.text(label,'当前 62.5 tok/s');motion.text(label,'当前 44.8 tok/s');
    step(0);step(80);const current=label.textContent;
    motion.text(label,'当前 60.3 tok/s');step(90);
    assert.equal(label.textContent,current);
    step(310);assert.equal(label.textContent,'当前 60.3 tok/s');
    motion.text(label,'当前 65.0 tok/s');step(400);reduce();
    assert.equal(label.textContent,'当前 65.0 tok/s');
    assert.equal(frames.size,0);assert.equal(motion.numbers.size,0);
    motion.text(label,'当前 66.0 tok/s');assert.equal(frames.size,0);
    assert.equal(label.textContent,'当前 66.0 tok/s');
  });
});
