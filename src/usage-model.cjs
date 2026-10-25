'use strict';

const FIELDS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
const emptyUsage = () => Object.fromEntries(FIELDS.map(k => [k, 0]));
const number = n => Number.isFinite(n) && n >= 0 ? n : null;
const clamp = n => Math.min(100, Math.max(0, n));

function usage(v) {
  if (!v || number(v.input_tokens) === null || number(v.output_tokens) === null) return null;
  const out = emptyUsage();
  for (const k of FIELDS) out[k] = number(v[k]) ?? 0;
  out.total_tokens = number(v.total_tokens) ?? out.input_tokens + out.output_tokens;
  return out;
}
function add(a, b) { for (const k of FIELDS) a[k] += b[k]; return a; }
function difference(a, b) { return Object.fromEntries(FIELDS.map(k => [k, Math.max(0, a[k] - b[k])])) }

function statisticsFor(turns) {
  const output=turns.reduce((n,t)=>n+(t.usage?.output_tokens??0),0);
  const measured=turns.filter(t=>(t.usage?.output_tokens??0)>0);
  const complete=measured.length>0&&measured.every(t=>t.estimatedGenerationTps!=null&&t.generatedMs>0);
  const generatedMs=complete?measured.reduce((n,t)=>n+t.generatedMs,0):null;
  const durationMs=turns.every(t=>t.durationMs!=null)?turns.reduce((n,t)=>n+t.durationMs,0):null;
  return {generatedMs,durationMs,estimatedGenerationTps:generatedMs>0?output*1000/generatedMs:null,
    averageTps:durationMs>0&&output>0?output*1000/durationMs:null};
}

function usageParts(usage,compact=false) {
  const cached=usage?Math.min(usage.input_tokens,usage.cached_input_tokens):null;
  const parts=[
    {key:'uncached',label:'未缓存输入',amount:usage?usage.input_tokens-cached:null},
    {key:'cached',label:'缓存输入',amount:cached},
    {key:'output',label:compact?'输出':'输出（含推理）',amount:usage?.output_tokens}
  ];
  const missing=usage?Math.max(0,usage.total_tokens-usage.input_tokens-usage.output_tokens):0;
  if(missing>0){
    for(const part of parts)if(part.amount===0)part.amount=null;
    parts.push({key:'unknown',label:'未分类',amount:missing});
  }
  return parts;
}

module.exports = { FIELDS, emptyUsage, number, clamp, usage, add, difference, statisticsFor, usageParts };
