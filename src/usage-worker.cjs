'use strict';
const path = require('node:path');
const {parentPort,workerData} = require('node:worker_threads');
const {RolloutStore} = require('./rollout-store.cjs');
const {AgentSpeed} = require('./agent-speed.cjs');

const database = workerData?.database ?? (process.env.LOCALAPPDATA &&
  path.join(process.env.LOCALAPPDATA,'AgentSpeed','history.sqlite'));
const store = new RolloutStore(workerData?.home, new AgentSpeed(database));
const reading = new Map();

parentPort.on('message', ({id,data}) => {
  const {threadId,knownRevision} = data;
  // Serialize reads of one file; a slow history read need not block another chat.
  const previous = reading.get(threadId) ?? Promise.resolve();
  const task = previous.then(async () => {
    const snapshot = await store.read(threadId,{knownRevision});
    const filename = threadId ? store.files.get(threadId.toLowerCase()) : null;
    parentPort.postMessage({id,value:{snapshot,filename}});
  }).catch(error => parentPort.postMessage({id,error:String(error)}));
  reading.set(threadId,task);
  task.finally(() => { if (reading.get(threadId) === task) reading.delete(threadId); });
});
