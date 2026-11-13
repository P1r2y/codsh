'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { UsageAccumulator, normalizeLimits } = require('./usage-data.cjs');
const { ProjectCache, projectFromLog } = require('./project-cache.cjs');
const { UUID } = require('./protocol.cjs');

class RolloutStore {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    this.home = home;
    this.files = new Map();
    this.cache = new Map();
    this.lastIndex = 0;
    this.indexPromise = null;
    this.misses = new Map();
    this.projectCache = new ProjectCache(home);
    this.latestLimits = null;
    this.lastQuotaCheck = 0;
    this.quotaFiles = new Map();
    this.quotaRead = null;
  }
  async index(force = false) {
    if (this.indexPromise) return this.indexPromise;
    if (this.lastIndex && !force) return;
    this.indexPromise = (async () => {
      const files = new Map();
      for (const root of ['sessions', 'archived_sessions']) {
        const visit = async dir => {
          let entries;
          try { entries = await fsp.readdir(dir, {withFileTypes:true}); } catch { return; }
          for (const entry of entries) {
            const filename = path.join(dir, entry.name);
            if (entry.isDirectory()) await visit(filename);
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
              const id = entry.name.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1];
              if (id) files.set(id.toLowerCase(), filename);
            }
          }
        };
        await visit(path.join(this.home, root));
      }
      this.files = files;
      this.lastIndex = Date.now();
    })().finally(() => { this.indexPromise = null; });
    return this.indexPromise;
  }
  async find(id) {
    const alreadyIndexed = Boolean(this.lastIndex);
    await this.index();
    if (this.files.has(id)) return this.files.get(id);
    const now = Date.now();
    if (alreadyIndexed && now - (this.misses.get(id) ?? 0) >= 30000) {
      this.misses.set(id, now);
      await this.index(true);
    } else if (!this.misses.has(id)) this.misses.set(id, now);
    while (this.misses.size > 100) this.misses.delete(this.misses.keys().next().value);
    return this.files.get(id);
  }
  async read(id, options = {}) {
    if (id !== null && (typeof id !== 'string' || !UUID.test(id))) throw new Error('会话 ID 无效');
    if (id === null) {
      await this.index();
      if (this.quotaRead) return this.quotaRead;
      if (Date.now() - this.lastQuotaCheck > 30000) {
        this.quotaRead=(async()=>{
          const recent = [...this.files.values()].sort().reverse().slice(0, 20);
          const keep=new Set(recent);
          for(const file of this.quotaFiles.keys())if(!keep.has(file))this.quotaFiles.delete(file);
          for (const file of recent) {
            let handle;
            try {
              const stat = await fsp.stat(file);
              const signature=`${stat.size}:${stat.mtimeMs}:${stat.birthtimeMs}`;
              if(this.quotaFiles.get(file)===signature)continue;
              handle = await fsp.open(file, 'r');
              const length = Math.min(stat.size, 512 * 1024), buf = Buffer.alloc(length);
              await handle.read(buf, 0, length, stat.size - length);
              for (const line of buf.toString('utf8').split('\n').reverse()) {
                if (!line.includes('"rate_limits"')) continue;
                try {
                  const event = JSON.parse(line);
                  if (event.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.rate_limits) {
                    const limits = normalizeLimits(event.payload.rate_limits, Date.parse(event.timestamp));
                    if (limits && (!this.latestLimits || limits.observedAt > this.latestLimits.observedAt)) this.latestLimits = limits;
                    break;
                  }
                } catch {}
              }
              this.quotaFiles.set(file,signature);
            } catch {} finally { if (handle) await handle.close(); }
          }
          this.lastQuotaCheck=Date.now();
          return {threadId:null,available:false,limits:this.latestLimits};
        })().finally(()=>{this.quotaRead=null;});
        return this.quotaRead;
      }
      return {threadId:null, available:false, limits:this.latestLimits};
    }
    id = id.toLowerCase();
    let filename = await this.find(id);
    if (!filename) return {threadId:id, available:false, limits:this.latestLimits, reason:'暂未找到本地会话日志'};
    let stat;
    try { stat = await fsp.stat(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.index(true);
      filename = this.files.get(id);
      if (!filename) return {threadId:id, available:false, limits:this.latestLimits, reason:'暂未找到本地会话日志'};
      stat = await fsp.stat(filename);
    }
    let item = this.cache.get(id);
    if (item) await item.ready;
    if (item && (item.filename !== filename || item.position > stat.size ||
        item.stat && (item.stat.birthtimeMs !== stat.birthtimeMs ||
          item.stat.ino && stat.ino && item.stat.ino !== stat.ino ||
          item.position === stat.size && item.stat.mtimeMs !== stat.mtimeMs))) {
      this.projectCache.pending.delete(id);
      this.cache.delete(id);
      item = null;
    }
    if (!item) {
      item = {id, filename, position:0, pending:Buffer.alloc(0), acc:new UsageAccumulator(),
        cwd:null, stat:null, reading:null, snapshot:null, snapshotVersion:-1,
        key:crypto.randomBytes(8).toString('hex'), stateVersion:0};
      this.cache.set(id, item);
      item.ready = (async () => {
        item.cwd = await projectFromLog(filename, this.home);
        const restored = await this.projectCache.restore(item.cwd, id, filename, stat);
        if (restored) { item.position = restored.offset; item.acc = restored.acc; }
      })();
      await item.ready;
    }
    if (!item.reading) {
      item.reading = this.update(item, stat.size).finally(() => { item.reading = null; });
    }
    const changed = await item.reading;
    item.stat = stat;
    if (changed) this.projectCache.schedule(item);
    this.cache.delete(id);
    this.cache.set(id, item);
    while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
    if (item.acc.limits && (!this.latestLimits || item.acc.limits.observedAt > this.latestLimits.observedAt)) this.latestLimits = item.acc.limits;
    const live = item.acc.turns.get(item.acc.currentId);
    const isLive = Boolean(live && !live.completed);
    const limits = this.latestLimits ?? item.acc.limits;
    const revision = `${item.key}:${item.stateVersion}:${limits?.observedAt ?? ''}`;
    if (options.knownRevision === revision) {
      const durationMs = isLive && Number.isFinite(live.start) ? Math.max(0, Date.now() - live.start) : null;
      const liveTick = isLive ? {id:live.id, durationMs,
        averageTps:durationMs > 0 && live.usage.output_tokens > 0 ? live.usage.output_tokens * 1000 / durationMs : null} : null;
      return {threadId:id, revision, unchanged:true, liveTick};
    }
    if (!item.snapshot || item.snapshotVersion !== item.stateVersion || isLive) {
      item.snapshot = item.acc.snapshot();
      item.snapshotVersion = item.stateVersion;
    }
    return {...item.snapshot, threadId:id, limits, updatedAt:stat.mtimeMs, revision};
  }
  async update(item, size) {
    if (item.position === size) return false;
    const handle = await fsp.open(item.filename, 'r');
    let changed = false;
    try {
      while (item.position < size) {
        const bytes = Buffer.alloc(Math.min(256 * 1024, size - item.position));
        const {bytesRead} = await handle.read(bytes, 0, bytes.length, item.position);
        if (!bytesRead) break;
        item.position += bytesRead;
        const chunk = bytes.subarray(0, bytesRead);
        const data = item.pending.length ? Buffer.concat([item.pending, chunk]) : chunk;
        let start = 0, end;
        while ((end = data.indexOf(10, start)) !== -1) {
          const line = data.subarray(start, end).toString('utf8');
          start = end + 1;
          // Only usage and timing events are parsed; conversation content is never cached.
          if (!/"type"\s*:\s*"(?:token_usage_record|event_msg|turn_context|session_meta)"/.test(line)) continue;
          try {
            const event = JSON.parse(line);
            item.acc.feed(event);
            if (event.type === 'turn_context' || event.type === 'token_usage_record' ||
                event.type === 'event_msg' && ['task_started','token_count','item_completed',
                  'task_complete','turn_aborted','task_aborted'].includes(event.payload?.type)) changed = true;
          } catch {}
        }
        item.pending = Buffer.from(data.subarray(start));
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally { await handle.close(); }
    if (changed) item.stateVersion++;
    return changed;
  }
}
module.exports = {RolloutStore};
