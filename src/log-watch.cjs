'use strict';
const fs=require('node:fs');

class LogWatchSet {
  constructor(notify,delay=1500) { this.notify=notify; this.delay=delay; this.records=new Map(); }
  select(owner,threadId,filename) {
    if(owner.isDestroyed()){this.records.get(owner.id)?.close();return false;}
    const old=this.records.get(owner.id);
    if (old?.threadId===threadId&&old.filename===filename) return true;
    old?.close();
    if (!threadId||!filename) return false;
    let watcher,timer;
    const close=()=>{
      clearTimeout(timer); watcher?.close(); owner.removeListener('destroyed',close);
      if (this.records.get(owner.id)?.close===close) this.records.delete(owner.id);
    };
    const send=watching=>{if (!owner.isDestroyed()) this.notify(owner,{threadId,watching});};
    try {
      watcher=fs.watch(filename,{persistent:false},event=>{
        if (event==='rename') {close();send(false);return;}
        if (!timer) {
          timer=setTimeout(()=>{timer=null;send(true);},this.delay);timer.unref?.();
        }
      });
      watcher.on('error',()=>{close();send(false);});
      owner.once('destroyed',close);
      this.records.set(owner.id,{threadId,filename,close});
      return true;
    } catch { close();return false; }
  }
  dispose() { for (const record of [...this.records.values()]) record.close(); }
}
module.exports={LogWatchSet};
