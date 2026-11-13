// Coalesce history work and yield between small batches.
export class BackgroundScan {
  constructor({interval=1200,gap=48,batchSize=8,budgetMs=3,now=()=>performance.now()}={}) {
    Object.assign(this,{interval,gap,batchSize,budgetMs,now});
    this.lastStarted=-Infinity;
    this.timer=null;this.idle=null;this.pending=null;this.iterator=null;this.disposed=false;
    this.requestIdle=globalThis.requestIdleCallback?.bind(globalThis)??(fn=>setTimeout(()=>fn({didTimeout:false,timeRemaining:()=>50}),0));
    this.cancelIdle=globalThis.cancelIdleCallback?.bind(globalThis)??clearTimeout;
  }
  request(factory) {
    if(this.disposed)return;
    this.pending=factory;
    if(this.timer===null&&this.idle===null)this.plan(Math.max(0,this.interval-(this.now()-this.lastStarted)));
  }
  plan(delay) {
    this.timer=setTimeout(()=>{
      this.timer=null;
      this.idle=this.requestIdle(deadline=>{this.idle=null;this.run(deadline);},{timeout:500});
    },delay);
  }
  run(deadline) {
    if(this.disposed)return;
    if(!this.iterator){
      const factory=this.pending;this.pending=null;
      if(!factory)return;
      this.iterator=factory();this.lastStarted=this.now();
    }
    const start=this.now(),limit=deadline.didTimeout?1:this.batchSize;
    try {
      for(let count=0;count<limit;count++){
        if(count&&(this.now()-start>=this.budgetMs||deadline.timeRemaining()<1))break;
        if(this.iterator.next().done){this.iterator=null;break;}
      }
    } catch(error) {
      this.iterator=null;console.warn('[CodexUsageUI]',String(error));
    }
    if(this.iterator)this.plan(this.gap);
    else if(this.pending)this.plan(Math.max(this.gap,this.interval-(this.now()-this.lastStarted)));
  }
  cancel() {
    clearTimeout(this.timer);if(this.idle!==null)this.cancelIdle(this.idle);
    this.timer=null;this.idle=null;this.pending=null;
    this.iterator?.return?.();this.iterator=null;this.lastStarted=-Infinity;
  }
  dispose(){this.cancel();this.disposed=true;}
}
