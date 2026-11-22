'use strict';
const {Worker} = require('node:worker_threads');

class WorkerClient {
  constructor(filename,workerData) {
    this.filename = filename;
    this.workerData = workerData;
    this.requests = new Map();
    this.sequence = 0;
    this.worker = null;
    this.closed = false;
  }
  start() {
    const worker = new Worker(this.filename,{workerData:this.workerData});
    this.worker = worker;
    worker.on('message', ({id,value,error}) => {
      const request = this.requests.get(id);
      if (!request) return;
      this.requests.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(value);
      if (!this.requests.size) worker.unref();
    });
    const fail = error => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const request of this.requests.values()) request.reject(error);
      this.requests.clear();
    };
    worker.once('error',fail);
    worker.once('exit',() => fail(new Error('Usage worker exited')));
    return worker;
  }
  async request(type,data) {
    if (this.closed) throw new Error('Usage worker closed');
    const worker = this.worker ?? this.start();
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      this.requests.set(id,{resolve,reject});
      worker.ref();
      try { worker.postMessage({id,type,data}); }
      catch (error) {
        this.requests.delete(id);
        if (!this.requests.size) worker.unref();
        reject(error);
      }
    });
  }
  async dispose() {
    this.closed = true;
    if (this.worker) await this.worker.terminate();
  }
}
module.exports = {WorkerClient};
