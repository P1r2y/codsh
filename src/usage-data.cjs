'use strict';

const { FIELDS, emptyUsage, number, clamp, usage, add, difference } = require('./usage-model.cjs');
const { normalizeLimits } = require('./quota-model.cjs');
const time = v => typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
const modelName = value => typeof value === 'string' && value.trim() ? value.trim() : null;
function addModel(groups, model, value) {
  if (!groups.has(model)) groups.set(model, emptyUsage());
  add(groups.get(model), value);
}
function includeUnassigned(groups, total) {
  const counted = [...groups.values()].reduce((sum, u) => add(sum, u), emptyUsage());
  const missing = difference(total, counted);
  missing.cached_input_tokens = Math.min(missing.input_tokens, missing.cached_input_tokens);
  missing.reasoning_output_tokens = Math.min(missing.output_tokens, missing.reasoning_output_tokens);
  missing.total_tokens = missing.input_tokens + missing.output_tokens;
  if (missing.total_tokens > 0) addModel(groups, null, missing);
}
function modelEntries(groups) {
  return [...groups].map(([model, value]) => ({model, usage:{...value},
    cacheHitPercent:value.input_tokens > 0 ? clamp(100*value.cached_input_tokens/value.input_tokens) : null}))
    .sort((a,b) => (a.model === null)-(b.model === null) || (a.model ?? '').localeCompare(b.model ?? ''));
}
function unionDuration(intervals) {
  let end = -Infinity, total = 0;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b);
    }
  }
  return total;
}
function generationTiming(t) {
  const records=t.hasRecords?t.responses:t.legacyResponses;
  let cursor=0,complete=records.length>0;const intervals=[];
  for(const record of records){
    const batch=[];
    while(cursor<t.modelItems.length&&t.modelItems[cursor].order<record.order)batch.push(t.modelItems[cursor++]);
    if(record.usage.output_tokens===0)continue;
    const measured=batch.filter(i=>Number.isFinite(i.start)&&Number.isFinite(i.end)&&i.end>i.start);
    const reasoning=measured.filter(i=>i.kind==='reasoning');
    // 与该次响应的输出配对；快照接收时的极短推理事件不能作为完整生成时长。
    if(unionDuration(measured.map(i=>[i.start,i.end]))<50||
      record.usage.reasoning_output_tokens>0&&unionDuration(reasoning.map(i=>[i.start,i.end]))<50)complete=false;
    intervals.push(...measured.map(i=>[i.start,i.end]));
  }
  return {complete,ms:complete?unionDuration(intervals):null};
}

class UsageAccumulator {
  constructor() {
    this.total = emptyUsage(); this.hasTotal = false; this.turns = new Map(); this.currentId = null;
    this.lastUsage = null; this.contextWindow = null; this.limits = null; this.model = null;
    this.ids = new Set(); this.meta = null;this.order=0;this.turnModels=new Map();
  }
  turn(id) {
    if (!id) return null;
    if (!this.turns.has(id)) this.turns.set(id, {id, start:null, end:null, completed:false,
      status:'进行中', usage:emptyUsage(), hasRecords:false,
      requests:0, recordIds:new Set(), itemIds:new Set(), tools:0,
      responses:[],legacyResponses:[],modelItems:[],lastActivity:null,endInferred:false,model:this.turnModels.get(id)??this.model});
    return this.turns.get(id);
  }
  feed(event) {
    const p = event.payload ?? {}, stamp = time(event.timestamp);
    const order=++this.order;
    if (event.type === 'session_meta') {
      this.meta = {id:p.id, originator:p.originator, source:p.source, cwd:p.cwd}; return;
    }
    if (event.type === 'turn_context') {
      this.model = modelName(p.model) ?? this.model;
      const id = p.turn_id ?? this.currentId;
      if (id) this.turnModels.set(id, this.model);
      const t = this.turns.get(id);
      if (t) t.model = this.model;
      return;
    }
    if (event.type === 'token_usage_record') {
      const t = this.turn(p.turn_id ?? this.currentId), u = usage(p.usage);
      const key = p.response_id ?? `ordinal:${event.ordinal ?? event.timestamp}`;
      if (!t || !u || t.recordIds.has(key) || (p.response_id && this.ids.has(p.response_id))) return;
      t.recordIds.add(key); if (!t.hasRecords) { t.usage = emptyUsage(); t.requests = 0; }
      if (p.response_id) this.ids.add(p.response_id);
      t.hasRecords = true; add(t.usage, u); t.requests++;
      t.responses.push({order,usage:u,model:modelName(p.model) ?? t.model});
      this.hasTotal = true;
      if(Number.isFinite(stamp))t.lastActivity=stamp;
      const cumulative = usage(p.thread_token_usage);
      if (cumulative) { this.total = cumulative; this.hasTotal = true; }
      return;
    }
    if (event.type !== 'event_msg') return;
    if (p.type === 'task_started') {
      const previous=this.turns.get(this.currentId);
      if(previous&&!previous.completed&&previous.id!==p.turn_id){
        previous.completed=true;previous.endInferred=true;previous.status='已结束（记录不完整）';
        previous.end=previous.lastActivity??previous.start;
      }
      this.currentId = p.turn_id; const t = this.turn(this.currentId);
      if (t && t.start === null) t.start = number(p.started_at) === null ? stamp : time(p.started_at);
      if(t&&Number.isFinite(stamp))t.lastActivity=stamp;
      this.contextWindow = number(p.model_context_window) ?? this.contextWindow; return;
    }
    const t = this.turn(p.turn_id ?? this.currentId);
    if(t&&!t.completed&&Number.isFinite(stamp)&&p.type==='item_completed')t.lastActivity=stamp;
    if (p.type === 'token_count') {
      const cumulative = usage(p.info?.total_token_usage);
      if (cumulative) {
        // total 包含 input + output；cached 已经包含在 input 内。
        const prior=this.total;
        const changed = !this.hasTotal || cumulative.total_tokens !== this.total.total_tokens;
        if(t&&!t.completed&&changed&&Number.isFinite(stamp))t.lastActivity=stamp;
        this.total = cumulative; this.hasTotal = true;
        if (t && !t.hasRecords && changed) {
          const delta=difference(cumulative,prior);
          delta.total_tokens=delta.input_tokens+delta.output_tokens;
          if(delta.total_tokens>0){
            add(t.usage,delta);t.requests++;
            t.legacyResponses.push({order,usage:usage(p.info?.last_token_usage)??delta,countedUsage:delta,
              model:modelName(p.model) ?? modelName(p.info?.model) ?? t.model});
          }
        }
      }
      this.lastUsage = usage(p.info?.last_token_usage) ?? this.lastUsage;
      this.contextWindow = number(p.info?.model_context_window) ?? this.contextWindow;
      if (p.rate_limits) this.limits = normalizeLimits(p.rate_limits, stamp);
    } else if (p.type === 'item_completed' && t) {
      const item = p.item ?? {}, key = item.id;
      if (key && t.itemIds.has(key)) return;
      if (key) t.itemIds.add(key);
      const kind = String(item.type ?? '').toLowerCase();
      if (['reasoning', 'agentmessage', 'agent_message'].includes(kind)) {
        t.modelItems.push({order,kind,start:p.started_at_ms,end:p.completed_at_ms});
      } else if (['commandexecution', 'mcptoolcall', 'extension', 'dynamictoolcall'].includes(kind)) t.tools++;
    } else if (['task_complete','turn_aborted','task_aborted'].includes(p.type) && t) {
      t.completed = true; t.status = p.type === 'task_complete' ? '已完成' : '已中断';
      t.endInferred=false;
      t.end = number(p.completed_at) === null ? stamp : time(p.completed_at);
      t.durationMs = number(p.duration_ms);
      t.timeToFirstTokenMs = number(p.time_to_first_token_ms);
    }
  }
  snapshot(now = Date.now()) {
    const groups = new Map();
    const turns = [...this.turns.values()].map(t => {
      const models = new Map();
      for (const record of t.hasRecords ? t.responses : t.legacyResponses)
        addModel(models, record.model, record.countedUsage ?? record.usage);
      includeUnassigned(models, t.usage);
      for (const [model, value] of models) addModel(groups, model, value);
      const duration = t.durationMs ?? (Number.isFinite(t.start) ? Math.max(0,(t.end ?? now)-t.start) : null);
      const timing=generationTiming(t),generatedMs=timing.ms;
      return {id:t.id, completed:t.completed, status:t.status, startedAt:t.start, completedAt:t.end,endInferred:t.endInferred,
        usage:{...t.usage}, models:modelEntries(models), cacheHitPercent:t.usage.input_tokens > 0 ? clamp(100*t.usage.cached_input_tokens/t.usage.input_tokens) : null,
        requests:t.requests, tools:t.tools, durationMs:duration,
        averageTps:duration > 0 && t.usage.output_tokens > 0 ? t.usage.output_tokens*1000/duration : null,
        // 本机只有项目生成区间，无法覆盖每个请求的完整解码计时，必须标记为估速。
        estimatedGenerationTps:timing.complete&&generatedMs >= 50 && t.usage.output_tokens > 0 ? t.usage.output_tokens*1000/generatedMs : null,
        generatedMs,generationTimingComplete:timing.complete, timeToFirstTokenMs:t.timeToFirstTokenMs ?? null};
    });
    // 已记录的响应不会被较旧的累计快照扣减；无法归属的历史计数单列。
    includeUnassigned(groups, this.total);
    const total = [...groups.values()].reduce((sum, u) => add(sum, u), emptyUsage());
    return {model:this.model, models:modelEntries(groups), available:this.hasTotal, total, turnCount:turns.length,
      requests:turns.reduce((n,t)=>n+t.requests,0), cacheHitPercent:total.input_tokens > 0 ? clamp(100*total.cached_input_tokens/total.input_tokens) : null,
      contextPercent:this.contextWindow > 0 && this.lastUsage ? clamp(100*this.lastUsage.total_tokens/this.contextWindow) : null,
      contextWindow:this.contextWindow, lastUsage:this.lastUsage, turns, limits:this.limits};
  }
  toCache() {
    return {
      total:this.total, hasTotal:this.hasTotal, currentId:this.currentId, lastUsage:this.lastUsage,
      contextWindow:this.contextWindow, limits:this.limits, model:this.model, order:this.order,
      ids:[...this.ids], turnModels:[...this.turnModels],
      turns:[...this.turns.values()].map(turn => ({...turn, recordIds:[...turn.recordIds], itemIds:[...turn.itemIds]}))
    };
  }
  static fromCache(value) {
    try {
      if (!value || !usage(value.total) || typeof value.hasTotal !== 'boolean' ||
          !Number.isSafeInteger(value.order) || value.order < 0 ||
          !Array.isArray(value.ids) || !value.ids.every(id => typeof id === 'string') ||
          !Array.isArray(value.turnModels) || !value.turnModels.every(pair => Array.isArray(pair) && pair.length === 2 &&
            typeof pair[0] === 'string' && (pair[1] === null || typeof pair[1] === 'string')) ||
          !Array.isArray(value.turns) || (value.model != null && typeof value.model !== 'string') ||
          (value.lastUsage != null && !usage(value.lastUsage))) return null;
      const acc = new UsageAccumulator();
      Object.assign(acc, {total:usage(value.total), hasTotal:value.hasTotal, currentId:value.currentId ?? null,
        lastUsage:value.lastUsage == null ? null : usage(value.lastUsage), contextWindow:value.contextWindow ?? null,
        limits:value.limits ?? null, model:value.model ?? null, order:value.order});
      acc.ids = new Set(value.ids);
      acc.turnModels = new Map(value.turnModels);
      for (const turn of value.turns) {
        if (!turn || typeof turn.id !== 'string' || !usage(turn.usage) ||
            !Array.isArray(turn.recordIds) || !Array.isArray(turn.itemIds) ||
            !turn.recordIds.every(id => typeof id === 'string') || !turn.itemIds.every(id => typeof id === 'string') ||
            !Array.isArray(turn.responses) || !Array.isArray(turn.legacyResponses) || !Array.isArray(turn.modelItems) ||
            !turn.modelItems.every(item => item && Number.isFinite(item.order)) ||
            ![...turn.responses, ...turn.legacyResponses].every(record => record && Number.isFinite(record.order) &&
              usage(record.usage) && (record.countedUsage == null || usage(record.countedUsage)) &&
              (record.model == null || typeof record.model === 'string'))) return null;
        acc.turns.set(turn.id, {...turn, usage:usage(turn.usage), recordIds:new Set(turn.recordIds), itemIds:new Set(turn.itemIds)});
      }
      return acc;
    } catch { return null; }
  }
}
module.exports = {UsageAccumulator, normalizeLimits, unionDuration};
