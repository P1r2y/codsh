const fs=require('node:fs');const path=require('node:path');
const {UsageAccumulator}=require('../src/usage-data.cjs');
const a=new UsageAccumulator(), now=Date.now();
const msg=(type,payload)=>a.feed({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type,...payload}});
for(const [id,input,cached,output,seconds] of [['first',400000,350000,4000,60],['second',500000,450000,5000,80]]){
 msg('task_started',{turn_id:id,started_at:now/1000-seconds});
 a.feed({type:'turn_context',payload:{turn_id:id,model:id==='first'?'gpt-6.1-sol':'gpt-6-astra'}});
 msg('item_completed',{turn_id:id,item:{id:'message-'+id,type:'AgentMessage'},started_at_ms:now-30000,completed_at_ms:now});
 a.feed({type:'token_usage_record',payload:{turn_id:id,response_id:id,usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output,total_tokens:input+output}}});
 msg('task_complete',{turn_id:id,completed_at:now/1000,duration_ms:seconds*1000});
}
msg('token_count',{info:{total_token_usage:{input_tokens:900000,cached_input_tokens:800000,output_tokens:9000,total_tokens:909000},last_token_usage:{input_tokens:43000,cached_input_tokens:40000,output_tokens:3000,total_tokens:46000},model_context_window:475000},rate_limits:{primary:{used_percent:44,window_minutes:10080,resets_at:Math.floor(now/1000)+4*86400},secondary:null}});
const snapshot={...a.snapshot(),threadId:'00000000-0000-4000-8000-000000000001'};
fs.writeFileSync(path.join(__dirname,'fixture.json'),JSON.stringify({snapshot},null,2));
