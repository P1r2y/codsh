// Coalesce history work and yield between small batches.
export class BackgroundScan {
  constructor({interval=1200,gap=48,batchSize=8,budgetMs=3,now=()=>performance.now()}={}) {
    Object.assign(this,{interval,gap,batchSize,budgetMs,now});
    this.lastStarted=-Infinity;
    this.timer=null;this.idle=null;this.pending=null;this.iterator=null;this.disposed=false;
    this.updates = [];
    this.requestIdle=globalThis.requestIdleCallback?.bind(globalThis)??(fn=>setTimeout(()=>fn({didTimeout:false,timeRemaining:()=>50}),0));
    this.cancelIdle=globalThis.cancelIdleCallback?.bind(globalThis)??clearTimeout;
  }
  request(factory, visible = false) {
    if(this.disposed)return;
    this.pending=factory;
    if (visible && !this.urgent) {
      this.urgent = true;
      clearTimeout(this.timer);
      if (this.idle !== null) this.cancelIdle(this.idle);
      this.idle = null;
      this.plan(0);
    } else if(this.timer===null&&this.idle===null)this.plan(Math.max(0,this.interval-(this.now()-this.lastStarted)));
  }
  plan(delay) {
    this.timer=setTimeout(()=>{
      this.timer=null;
      // On navigation, start the newest few rows before waiting for an idle callback.
      if (this.lastStarted === -Infinity || this.urgent) {
        this.urgent = false;
        this.run({didTimeout:false,timeRemaining:()=>this.budgetMs});
        return;
      }
      this.idle=this.requestIdle(deadline=>{this.idle=null;this.run(deadline);},{timeout:500});
    },delay);
  }
  run(deadline) {
    if(this.disposed)return;
    const deferred = this.updates.length > 0;
    if(!this.iterator && !deferred){
      const factory=this.pending;this.pending=null;
      if(!factory)return;
      this.iterator=factory();this.lastStarted=this.now();
    }
    const start=this.now(),limit=deadline.didTimeout?1:this.batchSize;
    const hasTime = () => this.now() - start < this.budgetMs && deadline.timeRemaining() >= 1;
    try {
      // Read the native rows together. Updating one row before measuring the
      // next would force Chromium to lay out the conversation for every row.
      if (!deferred) {
        for (let count = 0; count < limit && (count === 0 || hasTime()); count++) {
          const {value, done} = this.iterator.next();
          if (value) this.updates.push(value);
          if (done) { this.iterator = null; break; }
        }
      }
      // A slow mount also consumes the budget. Resume unfinished writes before
      // measuring more rows, and give them a chance to revalidate their mount.
      for (let count = 0; count < limit && this.updates.length && (count === 0 || hasTime()); count++) {
        const update = this.updates.shift();
        update(deferred);
      }
    } catch(error) {
      this.updates.length = 0;
      this.iterator=null;console.warn('[CodexUsageUI]',String(error));
    }
    if(this.iterator || this.updates.length)this.plan(this.gap);
    else if(this.pending)this.plan(Math.max(this.gap,this.interval-(this.now()-this.lastStarted)));
  }
  cancel() {
    this.urgent = false;
    clearTimeout(this.timer);if(this.idle!==null)this.cancelIdle(this.idle);
    this.timer=null;this.idle=null;this.pending=null;
    this.updates.length = 0;
    this.iterator?.return?.();this.iterator=null;this.lastStarted=-Infinity;
  }
  dispose(){this.cancel();this.disposed=true;}
}
