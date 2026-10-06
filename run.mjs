import fs from 'node:fs';
import assert from 'node:assert/strict';
const H=1800,designs=['push_only','polling_only','proposed'];
const scenarios=[
{name:'missed_outage',changes:[{t:100,s:'offline',drop:true},{t:700,s:'available'}]},
{name:'duplicate_outage',changes:[{t:100,s:'offline',copies:3},{t:700,s:'available'}]},
{name:'stale_observations',changes:[{t:100,s:'offline',delay:700},{t:200,s:'available'}],slow:true},
{name:'missed_recovery',changes:[{t:100,s:'offline'},{t:400,s:'available',drop:true}]},
{name:'planned_maintenance',changes:[{t:100,s:'under_maintenance'},{t:700,s:'available'}]}];
function simulate(spec,design,seed=0){
let q=[],seq=0,now=0,last=0,truth='available',tv=1,status='available',v=1,requests=0,pushes=0,rejects=0,unsafe=0,blocked=0,mismatch=0,busy=false,generation=0,maxLoops=0,verifyRequests=0;
const log=[],latencies=[],pending=[];
function at(t,fn){if(t<=H)q.push({t,seq:seq++,fn});}
function record(kind){log.push({time:now,kind,truth,display:status,version:v});}
function update(s,version){if(version<v){rejects++;record('stale_rejected');return;}if(version===v)return;
const old=status;status=s;v=version;record('accepted');for(const p of pending)if(!p.done&&p.version===v){p.done=true;latencies.push(now-p.t);}
if(design==='proposed'&&old!==status){generation++;if(status==='offline'){maxLoops=1;scheduleVerify(generation);}}}
function request(kind,gen){if(kind==='verify'&&(gen!==generation||status!=='offline'))return;if(busy){at(now+1,()=>request(kind,gen));return;}
requests++;if(kind==='verify')verifyRequests++;busy=true;const captured={s:truth,v:tv};const delay=spec.slow&&now===120?300:2;
at(now+delay,()=>{busy=false;if(kind!=='verify'||gen===generation)update(captured.s,captured.v);else{rejects++;record('obsolete_verification_rejected');}if(kind==='verify'&&gen===generation&&status==='offline')scheduleVerify(gen);});}
function scheduleVerify(gen){at(now+60,()=>request('verify',gen));}
function periodic(period){at(now+period,()=>{request('periodic');periodic(period);});}
if(design==='polling_only')periodic(60);if(design==='proposed')periodic(300);
for(const c of spec.changes)at(c.t,()=>{truth=c.s;tv++;const version=tv;pending.push({t:now,version,done:false});record('truth_changed');if(design!=='polling_only'&&!c.drop)for(let i=0;i<(c.copies??1);i++)at(now+(c.delay??1)+i,()=>{pushes++;update(c.s,version);});});
at(H,()=>record('end'));while(q.length){q.sort((a,b)=>a.t-b.t||a.seq-b.seq);const e=q.shift();now=e.t;const dt=now-last;if(status!==truth)mismatch+=dt;if(status==='available'&&truth!=='available')unsafe+=dt;if(status!=='available'&&truth==='available')blocked+=dt;last=now;e.fn();}
return {result:{scenario:spec.name,seed,design,horizon_s:H,requests,verification_requests:verifyRequests,pushes,stale_or_obsolete_rejections:rejects,max_verification_loops:maxLoops,incorrectly_enabled_s:unsafe,incorrectly_disabled_s:blocked,status_mismatch_s:mismatch,observed_transitions:latencies.length,total_transitions:pending.length,max_observed_convergence_s:latencies.length?Math.max(...latencies):null,unobserved_transitions:pending.filter(p=>!p.done).length,final_correct:status===truth},log};}
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};}
const rows=[],traces={};for(const s of scenarios)for(const d of designs){const {result,log}=simulate(s,d);rows.push(result);traces[s.name+'/'+d]=log;}
for(let seed=1;seed<=100;seed++){const r=rng(seed),changes=[];for(let i=0;i<10;i++)changes.push({t:100+i*140,s:i%2?'available':'offline',drop:r()<.2,delay:1+Math.floor(r()*180),copies:r()<.2?2:1});for(const d of designs)rows.push(simulate({name:'seeded_loss_delay',changes},d,seed).result);}
const get=(s,d)=>rows.find(x=>x.scenario===s&&x.design===d);
assert.equal(get('missed_outage','push_only').incorrectly_enabled_s,600);assert.equal(get('missed_outage','polling_only').incorrectly_enabled_s,22);assert.equal(get('missed_outage','proposed').incorrectly_enabled_s,202);assert.equal(get('missed_recovery','proposed').incorrectly_disabled_s,11);assert.equal(get('planned_maintenance','proposed').verification_requests,0);assert.equal(get('duplicate_outage','proposed').max_verification_loops,1);for(const row of rows)assert.ok(row.max_verification_loops<=1);
const single=simulate({name:'single_outage',changes:[{t:100,s:'offline'},{t:700,s:'available'}]},'proposed').result;
assert.equal(single.requests,get('duplicate_outage','proposed').requests);
assert.equal(single.status_mismatch_s,get('duplicate_outage','proposed').status_mismatch_s);
assert.ok(get('stale_observations','proposed').stale_or_obsolete_rejections>=1);
const keys=Object.keys(rows[0]);fs.writeFileSync('results.csv',keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r[k]??'').join(',')).join('\n')+'\n');fs.writeFileSync('traces.json',JSON.stringify(traces,null,2));
const summary=designs.map(design=>{const a=rows.filter(x=>x.design===design&&x.seed>0),mean=k=>a.reduce((s,x)=>s+x[k],0)/a.length;return{design,runs:a.length,mean_requests:mean('requests'),mean_incorrectly_enabled_s:mean('incorrectly_enabled_s'),mean_incorrectly_disabled_s:mean('incorrectly_disabled_s'),mean_status_mismatch_s:mean('status_mismatch_s'),mean_unobserved_transitions:mean('unobserved_transitions'),final_correct_runs:a.filter(x=>x.final_correct).length};});fs.writeFileSync('summary.json',JSON.stringify({node:process.version,rows:rows.length,summary},null,2));console.log(JSON.stringify({directed:rows.filter(x=>x.seed===0),summary},null,2));
