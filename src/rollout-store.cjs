'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const { UsageAccumulator, normalizeLimits } = require('./usage-data.cjs');
const { UUID } = require('./protocol.cjs');

class RolloutStore {
  constructor(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    this.home = home; this.files = new Map(); this.cache = new Map(); this.lastIndex = 0; this.indexPromise = null;
    this.latestLimits = null; this.lastQuotaCheck = 0;
  }
  async index() {
    if (this.indexPromise) return this.indexPromise;
    if (Date.now()-this.lastIndex < 30000) return;
    this.indexPromise = (async()=>{
      for (const root of ['sessions','archived_sessions']) {
        const visit = async dir => {
          let entries; try { entries = await fsp.readdir(dir, {withFileTypes:true}); } catch { return; }
          for (const e of entries) {
            const p = path.join(dir,e.name);
            if (e.isDirectory()) await visit(p);
            else if (e.isFile() && e.name.endsWith('.jsonl')) {
              const id = e.name.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1];
              if (id) this.files.set(id,p);
            }
          }
        };
        await visit(path.join(this.home,root));
      }
      this.lastIndex = Date.now();
    })().finally(()=>{this.indexPromise=null});
    return this.indexPromise;
  }
  async read(id) {
    if (id !== null && !UUID.test(id)) throw new Error('会话 ID 无效');
    await this.index();
    if (!id) {
      if (Date.now()-this.lastQuotaCheck > 30000) {
        this.lastQuotaCheck=Date.now();
        // 首页没有当前会话，从最近的日志尾部寻找真实额度，不扫描聊天正文。
        const recent=[...this.files.values()].sort().reverse().slice(0,20);
        for (const file of recent) {
          let handle;
          try {
            const stat=await fsp.stat(file);handle=await fsp.open(file,'r');
            const length=Math.min(stat.size,512*1024), buf=Buffer.alloc(length);
            await handle.read(buf,0,length,stat.size-length);
            for (const line of buf.toString('utf8').split('\n').reverse()) {
              if(!line.includes('"rate_limits"'))continue;
              try {
                const e=JSON.parse(line);
                if(e.type==='event_msg' && e.payload?.type==='token_count' && e.payload.rate_limits){
                  const limits=normalizeLimits(e.payload.rate_limits,Date.parse(e.timestamp));
                  if(limits && (!this.latestLimits || limits.observedAt>this.latestLimits.observedAt))this.latestLimits=limits;
                  break;
                }
              } catch {}
            }
          } catch {} finally { if(handle)await handle.close(); }
        }
      }
      return {threadId:null, available:false, limits:this.latestLimits};
    }
    let filename = this.files.get(id);
    if (!filename) return {threadId:id, available:false, limits:this.latestLimits, reason:'暂未找到本地会话日志'};
    const stat = await fsp.stat(filename);
    let c = this.cache.get(id);
    if (!c || c.position > stat.size || c.filename !== filename) {
      c = {filename,position:0,remainder:'',decoder:new StringDecoder('utf8'),acc:new UsageAccumulator()}; this.cache.set(id,c);
    }
    if (!c.reading) c.reading = this.update(c,stat.size).finally(()=>{c.reading=null});
    await c.reading;
    this.cache.delete(id); this.cache.set(id,c);
    while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    const snapshot = c.acc.snapshot();
    if (snapshot.limits && (!this.latestLimits || snapshot.limits.observedAt > this.latestLimits.observedAt)) this.latestLimits = snapshot.limits;
    return {...snapshot,threadId:id,limits:this.latestLimits ?? snapshot.limits,updatedAt:stat.mtimeMs};
  }
  async update(c,size) {
    if (c.position === size) return;
    const handle = await fsp.open(c.filename,'r');
    try {
      while (c.position < size) {
        const bytes = Buffer.alloc(Math.min(256*1024,size-c.position));
        const {bytesRead} = await handle.read(bytes,0,bytes.length,c.position);
        if (!bytesRead) break;
        c.position += bytesRead;
        const lines = (c.remainder+c.decoder.write(bytes.subarray(0,bytesRead))).split('\n');
        c.remainder = lines.pop();
        for (const line of lines) {
          // 只解析计数与时钟事件，不把聊天正文传递给界面。
          if (!/"type"\s*:\s*"(?:token_usage_record|event_msg|turn_context|session_meta)"/.test(line)) continue;
          try { c.acc.feed(JSON.parse(line)); } catch { /* 写入中的半行在下一次读取时继续 */ }
        }
        await new Promise(resolve=>setImmediate(resolve));
      }
    } finally { await handle.close(); }
  }
}


module.exports = { RolloutStore };
