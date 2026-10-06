import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const depth=6;
const statuses=['available','maintenance','offline','unknown'];
const initial=()=>({epoch:0,rev:1,present:true,inc:'A',v:1,status:'available',gen:0,timers:0,pending:null});
const events=[];
for(const inc of ['A','B'])for(const v of [1,2,3])for(const status of statuses){
 events.push({type:'push',inc,v,status});
 events.push({type:'response',inc,v,status});
}
for(const rev of [1,2]){
 events.push({type:'snapshot',rev,present:false});
 for(const inc of ['A','B'])for(const v of [1,2,3])for(const status of statuses)events.push({type:'snapshot',rev,present:true,inc,v,status});
}
events.push({type:'beginVerification'},{type:'contextChange'});
function stop(s){s.gen++;s.timers=0;}
function apply(s,o,variant){
 if(!s.present){if(variant==='recreate_removed'){s.present=true;s.inc=o.inc;s.v=0;s.status='unknown';}else return;}
 if(s.inc!==o.inc)return;
 if(variant!=='no_version_guard' && o.v<=s.v){
  if(variant==='duplicate_timers' && o.v===s.v && o.status===s.status && s.status==='offline')s.timers++;
  return;
 }
 s.v=o.v;s.status=o.status;
 if(s.status==='offline'){if(s.timers===0)s.timers=1;}else stop(s);
}
function transition(before,e,variant){
 const s=structuredClone(before);
 if(e.type==='push')apply(s,e,variant);
 if(e.type==='beginVerification' && s.present && s.status==='offline' && s.timers && !s.pending)
  s.pending={epoch:s.epoch,inc:s.inc,gen:s.gen};
 if(e.type==='response' && s.pending){
  const q=s.pending;s.pending=null;
  if(q.epoch===s.epoch && q.inc===s.inc && (variant==='no_generation_guard'||q.gen===s.gen))apply(s,e,variant);
 }
 if(e.type==='snapshot' && e.rev>s.rev){
  s.rev=e.rev;
  if(!e.present){s.present=false;s.status='absent';stop(s);}
  else if(!s.present||e.inc!==s.inc){stop(s);s.present=true;s.inc=e.inc;s.v=e.v;s.status=e.status;s.timers=e.status==='offline'?1:0;}
  else apply(s,e,variant);
 }
 if(e.type==='contextChange' && s.epoch<1){s.epoch++;s.rev=0;s.present=false;s.status='absent';stop(s);}
 return s;
}
function violation(b,e,s){
 if(s.timers>1)return 'I1: more than one verification timer';
 if((!s.present||s.status!=='offline')&&s.timers!==0)return 'I2/I3: timer outside authorized offline state';
 if(s.epoch===b.epoch && s.present&&b.present &&s.inc===b.inc &&s.v<b.v)return 'I4: status version decreased';
 if(e.type==='push'&&!b.present&&s.present)return 'I5: push recreated absent application';
 if(e.type==='response'&&b.pending &&b.pending.gen!==b.gen && (s.status!==b.status||s.v!==b.v))return 'I6: obsolete verification generation changed status';
 if(e.type==='push'&&b.present&&e.inc===b.inc&&e.v<=b.v&&(s.status!==b.status||s.v!==b.v))return 'I4b: stale or equal-version push changed status';
 return null;
}
function explore(variant){
 const root=initial();const nodes=[{s:root,parent:-1,event:null,d:0}];const seen=new Map([[JSON.stringify(root),0]]);
 let examined=0,expanded=0;
 for(let k=0;k<nodes.length;k++){
  const n=nodes[k];if(n.d>=depth)continue;expanded++;
  for(const e of events){examined++;const s=transition(n.s,e,variant);const fail=violation(n.s,e,s);
   if(fail){const trace=[];let j=k;while(nodes[j].parent>=0){trace.push(nodes[j].event);j=nodes[j].parent;}trace.reverse();trace.push(e);
    return {variant,max_depth:depth,unique_states:seen.size,expanded_states:expanded,examined_transitions:examined,passed:false,violation:fail,counterexample:trace};}
   const key=JSON.stringify(s);if(!seen.has(key)){seen.set(key,nodes.length);nodes.push({s,parent:k,event:e,d:n.d+1});}
  }
 }
 return {variant,max_depth:depth,event_alphabet_size:events.length,unique_states:seen.size,expanded_states:expanded,examined_transitions:examined,passed:true,violation:null};
}
function scenario(name,seq,predicate){let s=initial();for(const e of seq)s=transition(s,e,'correct');return {name,passed:predicate(s),final_state:s};}
const scenarios=[
 scenario('lost outage repaired by snapshot',[{type:'snapshot',rev:2,present:true,inc:'A',v:2,status:'offline'}],s=>s.status==='offline'&&s.timers===1),
 scenario('maintenance invalidates pending response',[{type:'push',inc:'A',v:2,status:'offline'},{type:'beginVerification'},{type:'push',inc:'A',v:3,status:'maintenance'},{type:'response',inc:'A',v:3,status:'available'}],s=>s.status==='maintenance'&&s.timers===0),
 scenario('new incarnation rejects old push',[{type:'snapshot',rev:2,present:true,inc:'B',v:1,status:'available'},{type:'push',inc:'A',v:3,status:'offline'}],s=>s.inc==='B'&&s.status==='available'),
 scenario('recovery stops verification',[{type:'push',inc:'A',v:2,status:'offline'},{type:'push',inc:'A',v:3,status:'available'}],s=>s.status==='available'&&s.timers===0),
 scenario('context change rejects old verification',[{type:'push',inc:'A',v:2,status:'offline'},{type:'beginVerification'},{type:'contextChange'},{type:'response',inc:'A',v:3,status:'available'}],s=>!s.present&&s.timers===0)
];
const runs=['correct','no_version_guard','duplicate_timers','recreate_removed','no_generation_guard'].map(explore);
const report={model:'single-application portal coordination abstraction',runtime:process.version,max_depth:depth,generated_at:new Date().toISOString(),scope:'Bounded safety exploration with state deduplication, not all path enumeration, formal proof, implementation validation, performance benchmarking, or liveness proof.',runs,scenarios};
fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({runs,scenarios:scenarios.map(({name,passed})=>({name,passed}))},null,2));
if(!runs[0].passed||runs.slice(1).some(r=>r.passed)||scenarios.some(r=>!r.passed))process.exitCode=1;
