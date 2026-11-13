'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {parentPort,workerData}=require('node:worker_threads');
const VERSION=1, NAME='codsh-usage-cache.json';
const maxFile=workerData.maxCacheBytes??16*1024*1024;
const maxMemory=workerData.maxMemoryBytes??32*1024*1024, maxProjects=workerData.maxProjects??4;
const projects=new Map();
let memory=0, serializedEntries=0;
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');

function trim() {
  while (projects.size>maxProjects || memory>maxMemory) {
    const key=projects.keys().next().value;
    memory-=projects.get(key).bytes; projects.delete(key);
  }
}
async function project(cwd) {
  let p=projects.get(cwd);
  if (p) { projects.delete(cwd); projects.set(cwd,p); return p; }
  p={folder:path.join(cwd,'.codex'),file:path.join(cwd,'.codex',NAME),entries:new Map(),bytes:32};
  try {
    const folder=await fs.lstat(p.folder), file=await fs.lstat(p.file);
    if (folder.isDirectory()&&!folder.isSymbolicLink()&&file.isFile()&&!file.isSymbolicLink()&&file.size<=maxFile) {
      const data=JSON.parse(await fs.readFile(p.file,'utf8'));
      if (data.version===VERSION&&data.sessions&&typeof data.sessions==='object'&&!Array.isArray(data.sessions)) {
        for (const [id,entry] of Object.entries(data.sessions)) {
          const json=JSON.stringify(entry), bytes=Buffer.byteLength(json)+Buffer.byteLength(JSON.stringify(id))+2;
          p.entries.set(id,{json,bytes,savedAt:entry?.savedAt??0}); p.bytes+=bytes;
        }
      }
    }
  } catch { /* Missing, damaged or unwritable caches are optional. */ }
  projects.set(cwd,p); memory+=p.bytes;
  return p;
}
async function fingerprint(filename,offset) {
  const handle=await fs.open(filename,'r');
  try {
    if (offset>(await handle.stat()).size) return null;
    const length=Math.min(4096,offset);
    const at=async position=>{
      const buffer=Buffer.alloc(length),{bytesRead}=await handle.read(buffer,0,length,position);
      return bytesRead===length?hash(buffer):null;
    };
    const head=await at(0),tail=await at(offset-length);
    return head&&tail?{head,tail}:null;
  } finally { await handle.close(); }
}
async function restore(data) {
  const p=await project(data.cwd),raw=p.entries.get(data.id);
  try {
    if (!raw) return null;
    const e=JSON.parse(raw.json),s=data.stat;
    if (!e||!Number.isSafeInteger(e.offset)||e.offset<0||e.offset>s.size||e.birthtimeMs!==s.birthtimeMs||
        e.stateHash!==hash(JSON.stringify(e.state))||!e.fingerprint?.head||!e.fingerprint?.tail||
        e.size===s.size&&e.mtimeMs!==s.mtimeMs) return null;
    if (e.filename!==data.filename||e.size!==s.size||e.mtimeMs!==s.mtimeMs) {
      const sample=await fingerprint(data.filename,e.offset);
      if (!sample||sample.head!==e.fingerprint.head||sample.tail!==e.fingerprint.tail) return null;
    }
    return {offset:e.offset,state:e.state};
  } finally { trim(); }
}
async function write(data) {
  const {cwd,id,...fields}=data, stateJson=JSON.stringify(fields.state);
  if (Buffer.byteLength(stateJson)>maxFile-4096) return;
  const sample=await fingerprint(fields.filename,fields.offset);
  if (!sample) return;
  const p=await project(cwd),savedAt=Date.now();
  const json=JSON.stringify({...fields,fingerprint:sample,stateHash:hash(stateJson),savedAt});
  serializedEntries++;
  const bytes=Buffer.byteLength(json)+Buffer.byteLength(JSON.stringify(id))+2, old=p.entries.get(id);
  memory-=p.bytes; p.bytes-=old?.bytes??0;
  p.entries.delete(id); p.entries.set(id,{json,bytes,savedAt}); p.bytes+=bytes;
  if (p.bytes>maxFile) {
    for (const [key,entry] of [...p.entries].sort((a,b)=>a[1].savedAt-b[1].savedAt)) {
      if (p.bytes<=maxFile) break;
      p.entries.delete(key); p.bytes-=entry.bytes;
    }
  }
  memory+=p.bytes;
  let temporary;
  try {
    await fs.mkdir(p.folder,{recursive:true});
    const folder=await fs.lstat(p.folder);
    if (!folder.isDirectory()||folder.isSymbolicLink()) return;
    // Historical entries are already encoded; only the changed entry is serialized.
    const text='{"version":1,"sessions":{'+[...p.entries].map(([key,entry])=>JSON.stringify(key)+':'+entry.json).join(',')+'}}';
    temporary=`${p.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporary,text,{encoding:'utf8',flag:'wx'});
    await fs.rename(temporary,p.file); temporary=null;
  } finally {
    if (temporary) await fs.unlink(temporary).catch(()=>{});
    trim();
  }
}
let queue=Promise.resolve();
parentPort.on('message',message=>{
  queue=queue.then(async()=>{
    try {
      let value;
      if (message.type==='restore') value=await restore(message.data);
      else if (message.type==='write') value=await write(message.data);
      else if (message.type==='stats') value={projects:projects.size,bytes:memory,serializedEntries};
      else throw new Error('Unknown cache request');
      parentPort.postMessage({id:message.id,value});
    } catch (error) { parentPort.postMessage({id:message.id,error:String(error)}); }
  });
});
