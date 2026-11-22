'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { UsageAccumulator, normalizeLimits } = require('./usage-data.cjs');
const { ProjectCache, projectFromLog } = require('./project-cache.cjs');
const { UUID } = require('./protocol.cjs');

// Codex normally files UUIDv7 sessions under their local creation date.
async function findDatedLog(home, id) {
  if (id[14] !== '7') return;
  const created = new Date(parseInt(id.slice(0, 8) + id.slice(9, 13), 16));
  const localDay = [created.getFullYear(), String(created.getMonth() + 1).padStart(2, '0'),
    String(created.getDate()).padStart(2, '0')].join('-');
  const suffix = '-' + id + '.jsonl';
  const sessions = path.join(home, 'sessions');
  let root;
  try { root = await fsp.realpath(sessions); } catch { return; }
  for (const day of new Set([localDay, created.toISOString().slice(0, 10)])) {
    const datePath = path.join(...day.split('-'));
    const dir = path.join(sessions, datePath);
    try {
      if (path.relative(root, await fsp.realpath(dir)) !== datePath) continue;
      const entries = await fsp.readdir(dir, {withFileTypes:true});
      const file = entries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith(suffix));
      if (file) return path.join(dir, file.name);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') break;
    }
  }
}

function feedLine(item, bytes) {
  const line = bytes.toString('utf8');
  if (!/"type"\s*:\s*"(?:token_usage_record|event_msg|turn_context|session_meta)"/.test(line)) return false;
  try {
    const event = JSON.parse(line);
    item.acc.feed(event);
    return event.type === 'turn_context' || event.type === 'token_usage_record' ||
      event.type === 'event_msg' && ['task_started','token_count','item_completed',
        'task_complete','turn_aborted','task_aborted'].includes(event.payload?.type);
  } catch { return false; }
}

// A large response body can contain many MiB of tool output or image data.
// Only skip when the beginning identifies the top-level record unambiguously.
const responseHeader = /^\s*\{\s*(?:"timestamp"\s*:\s*"[0-9TZ:.+\-]+"\s*,\s*)?"type"\s*:\s*"response_item"\s*[,}]/;

function consumePart(item, part, complete, previousBytes) {
  if (!item.skipping && previousBytes < 192 && (!complete || part.length >= 4096)) {
    const prefix = item.parts.map(bytes => bytes.toString('latin1')).join('') +
      part.toString('latin1', 0, 192 - previousBytes);
    if (responseHeader.test(prefix)) {
      item.parts.length = 0;
      item.skipping = true;
    }
  }
  if (item.skipping) {
    item.skipping = !complete;
    return false;
  }
  if (!complete) {
    item.parts.push(part.byteOffset ? Buffer.from(part) : part);
    return false;
  }
  if (!item.parts.length) return feedLine(item, part);
  item.parts.push(part);
  const line = Buffer.concat(item.parts);
  item.parts.length = 0;
  return feedLine(item, line);
}

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
    if (this.files.has(id)) return this.files.get(id);
    const lastMiss = this.misses.get(id);
    if (lastMiss !== undefined && Date.now() - lastMiss < 1500) return;
    const dated = await findDatedLog(this.home, id);
    if (dated) {
      this.files.set(id, dated);
      this.misses.delete(id);
      return dated;
    }
    if (lastMiss !== undefined && Date.now() - lastMiss < 30000) return;
    await this.index(Boolean(this.lastIndex));
    if (this.files.has(id)) return this.files.get(id);
    this.misses.set(id, Date.now());
    while (this.misses.size > 100) this.misses.delete(this.misses.keys().next().value);
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
      item = {id, filename, position:0, completeOffset:0, parts:[], skipping:false, acc:new UsageAccumulator(),
        cwd:null, stat:null, reading:null, snapshot:null, snapshotVersion:-1,
        key:crypto.randomBytes(8).toString('hex'), stateVersion:0};
      this.cache.set(id, item);
      item.ready = (async () => {
        item.cwd = await projectFromLog(filename, this.home);
        const restored = await this.projectCache.restore(item.cwd, id, filename, stat);
        if (restored) { item.position = item.completeOffset = restored.offset; item.acc = restored.acc; }
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
        const offset = item.position - bytesRead;
        let start = 0;
        while (start < bytesRead) {
          const end = chunk.indexOf(10, start);
          const part = chunk.subarray(start, end < 0 ? bytesRead : end);
          if (consumePart(item, part, end >= 0, offset + start - item.completeOffset)) changed = true;
          if (end < 0) break;
          start = end + 1;
          item.completeOffset = offset + start;
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally { await handle.close(); }
    if (changed) item.stateVersion++;
    return changed;
  }
}
module.exports = {RolloutStore};
