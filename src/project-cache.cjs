'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {Worker} = require('node:worker_threads');
const {UsageAccumulator} = require('./usage-data.cjs');
const CACHE_NAME = 'codsh-usage-cache.json';

async function projectFromLog(filename, home) {
  let handle;
  try {
    handle = await fs.promises.open(filename, 'r');
    const chunks = [];
    for (let offset=0; offset<4*1024*1024; offset+=65536) {
      const chunk=Buffer.alloc(65536), {bytesRead}=await handle.read(chunk,0,chunk.length,offset);
      if (!bytesRead) break;
      const bytes=chunk.subarray(0,bytesRead), end=bytes.indexOf(10);
      chunks.push(end<0?bytes:bytes.subarray(0,end));
      if (end<0) continue;
      const event=JSON.parse(Buffer.concat(chunks).toString('utf8')), cwd=event.payload?.cwd;
      if (event.type!=='session_meta' || typeof cwd!=='string' || !path.isAbsolute(cwd)) return null;
      const dir=path.resolve(cwd);
      if ([path.parse(dir).root,os.homedir(),path.resolve(home)].some(p=>p.toLowerCase()===dir.toLowerCase())) return null;
      return (await fs.promises.stat(dir)).isDirectory()?dir:null;
    }
  } catch { /* Optional cache; the source log remains authoritative. */ }
  finally { if (handle) await handle.close(); }
  return null;
}

class ProjectCache {
  constructor(home, delay=10000, limits={}) {
    this.home=home; this.delay=delay; this.limits=limits;
    this.pending=new Map(); this.requests=new Map(); this.sequence=0;
    this.timer=null; this.flushing=null; this.worker=null; this.failed=false;
  }
  request(type, data) {
    if (this.failed) return Promise.reject(new Error('Project cache unavailable'));
    if (!this.worker) {
      const worker=new Worker(path.join(__dirname,'project-cache-worker.cjs'),{workerData:this.limits});
      this.worker=worker;
      worker.on('message',message=>{
        const pending=this.requests.get(message.id);
        if (!pending) return;
        this.requests.delete(message.id);
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
        if (!this.requests.size) worker.unref();
      });
      const fail=error=>{
        this.failed=true;
        for (const pending of this.requests.values()) pending.reject(error);
        this.requests.clear(); worker.unref();
      };
      worker.on('error',fail);
      worker.on('exit',()=>fail(new Error('Project cache worker exited')));
      worker.unref();
    }
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      this.requests.set(id,{resolve,reject}); this.worker.ref();
      try { this.worker.postMessage({id,type,data}); }
      catch (error) { this.requests.delete(id); if (!this.requests.size) this.worker.unref(); reject(error); }
    });
  }
  async restore(cwd,id,filename,stat) {
    if (!cwd) return null;
    try {
      const entry=await this.request('restore',{cwd,id,filename,stat:{size:stat.size,mtimeMs:stat.mtimeMs,birthtimeMs:stat.birthtimeMs}});
      const acc=entry && UsageAccumulator.fromCache(entry.state);
      return acc?{offset:entry.offset,acc}:null;
    } catch { return null; }
  }
  schedule(item) {
    if (!item.cwd || this.failed) return;
    this.pending.set(item.id,item);
    if (!this.timer) {
      this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delay);
      this.timer.unref?.();
    }
  }
  async flush() {
    if (this.flushing) return this.flushing;
    if (this.timer) { clearTimeout(this.timer); this.timer=null; }
    this.flushing=this.writePending().finally(()=>{this.flushing=null;});
    await this.flushing;
    if (this.pending.size && !this.timer) {
      this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delay);
      this.timer.unref?.();
    }
  }
  async writePending() {
    const items=[...this.pending.values()]; this.pending.clear();
    for (const item of items) {
      try {
        if (item.reading) await item.reading;
        if (!item.stat) continue;
        // postMessage snapshots this turn state before another log read can mutate it.
        const {size,mtimeMs,birthtimeMs}=item.stat;
        await this.request('write',{cwd:item.cwd,id:item.id,filename:item.filename,size,mtimeMs,birthtimeMs,
          offset:item.position-item.pending.length,state:item.acc.toCache()});
      } catch { /* A failed cache never prevents live statistics. */ }
    }
  }
  async dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.pending.clear(); this.failed=true;
    if (this.worker) await this.worker.terminate();
  }
}
module.exports={ProjectCache,projectFromLog,CACHE_NAME};
