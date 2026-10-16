const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js');

function random(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function entry(n,port=443){const ip=C.numberIP(C.ipNumber('104.16.0.0')+n+1);return {ip,port,key:ip+':'+port,n};}
function valid(s){return !!s&&!s.error&&s.status===204&&Number.isFinite(s.ms)&&s.ms>0;}
function sample(ms){return {status:204,ms,error:null};}
function staticData(entries,seed=0){
 const rng=random(seed),data=new Map();
 for(const e of entries) {
  const a=sample(10+Math.floor(rng()*100)*10),b=sample(10+Math.floor(rng()*100)*10);
  if(rng()<0.13)Object.assign(a,{status:0,error:'timeout',ms:4000});
  if(rng()<0.2)Object.assign(b,{status:503});
  data.set(e.key,[a,b]);
 }
 return data;
}
// Independent, exhaustive reference: both fixed observations for every entry
// are known. Random exploration is sampled from ALL unique IPs before either
// pass, including IPs not needed for the low-latency selection.
function reference(entries,current,limit,data,seed) {
 const groups=new Map(),currentKeys=new Set(current.map(e=>e.key));
 for(const e of entries){if(!groups.has(e.ip))groups.set(e.ip,[]);groups.get(e.ip).push(e);}
 const order=Array.from(groups.keys()),rng=random(seed);
 for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 const priority=new Map(order.map((ip,i)=>[ip,i]));
 const compare=(a,b)=>a.lightLatency-b.lightLatency||a.key.localeCompare(b.key);
 const best=[];
 for(const rows of groups.values()) {
  const passing=rows.filter(e=>data.get(e.key).every(valid))
   .map(e=>({...e,lightSamples:data.get(e.key).map(s=>({...s})),lightLatency:Math.max(...data.get(e.key).map(s=>s.ms))})).sort(compare);
  const preferred=passing.filter(e=>currentKeys.has(e.key));
  if(preferred.length||passing.length)best.push(preferred[0]||passing[0]);
 }
 const retained=best.filter(e=>currentKeys.has(e.key)).sort(compare).slice(0,limit);
 const others=best.filter(e=>!currentKeys.has(e.key)).sort(compare);
 const available=Math.min(Math.max(0,limit-retained.length),others.length),explore=Math.floor(available/5),fast=available-explore;
 const chosen=others.slice(0,fast),fastIPs=new Set(chosen.map(e=>e.ip));
 const exploration=others.filter(e=>!fastIPs.has(e.ip)).sort((a,b)=>priority.get(a.ip)-priority.get(b.ip)).slice(0,explore);
 return retained.map(e=>({...e,downloadReason:'current'})).concat(chosen.map(e=>({...e,downloadReason:'latency'})),exploration.map(e=>({...e,downloadReason:'exploration'})));
}
async function run(entries,current,limit,data,seed=42,options={}) {
 const calls=[],reports=[],activeEntries=new Set();let active=0,peak=0,peakSecond=0,rngCalls=0;
 const rng=random(seed),settings={...C.LIGHT_SCREEN.lite,maxConcurrency:8,...options.settings};
 const probe=async(e,pass)=>{
  assert([1,2].includes(pass));assert(!activeEntries.has(e.key),'one entry cannot have concurrent light samples');
  activeEntries.add(e.key);active++;peak=Math.max(peak,active);if(pass===2)peakSecond=Math.max(peakSecond,active);
  const event={key:e.key,ip:e.ip,pass,active,finished:false};calls.push(event);
  try {
   await new Promise(resolve=>setImmediate(resolve));
   if(options.probe)return await options.probe(e,pass,event,calls);
   const s=data.get(e.key)[pass-1];return s&&{...s};
  }finally{event.finished=true;active--;activeEntries.delete(e.key);}
 };
 const report=async p=>{reports.push(structuredClone(p));if(options.report)await options.report(p);};
 try {
  const result=await C.selectiveLightScreen(entries,current,limit,settings,probe,report,()=>{rngCalls++;return rng();});
  assert.equal(active,0);assert(calls.every(e=>e.finished));
  assert(peak<=settings.maxConcurrency);assert(peakSecond<=settings.maxConcurrency);
  const firstCalls=calls.filter(e=>e.pass===1),secondCalls=calls.filter(e=>e.pass===2);
  assert.equal(new Set(secondCalls.map(e=>e.key)).size,secondCalls.length,'an invalid second response is still a completed attempt');
  assert.equal(result.stats.firstRequests,firstCalls.length);assert.equal(result.stats.secondRequests,secondCalls.length);
  assert.equal(result.stats.secondTested,secondCalls.length);assert.equal(result.stats.selectionComplete,true);
  assert(result.stats.skippedSecond>=0);assert.equal(result.stats.skippedSecond,result.stats.firstPassedEntries-secondCalls.length);
  assert.equal(result.stats.secondPassedEntries,result.rows.length);
  assert.equal(result.stats.secondPassed,new Set(result.rows.map(e=>e.ip)).size);
  for(const p of reports)if(!p.stats.selectionComplete)assert.equal(p.stats.skippedSecond,0,'unfinished work must not be counted as safely skipped');
  return {result,calls,reports,peak,peakSecond,rngCalls};
 }catch(error){
  assert.equal(active,0,'failure must drain all in-flight requests');assert(calls.every(e=>e.finished));
  const count=calls.length;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,count);
  throw error;
 }
}
function assertSelection(actual,expected) {
 const compact=rows=>rows.map(e=>({key:e.key,reason:e.downloadReason,latency:e.lightLatency}));
 assert.deepEqual(compact(actual),compact(expected));
 assert.equal(new Set(actual.map(e=>e.ip)).size,actual.length);
 assert(actual.every(e=>e.lightSamples.length===2&&e.lightSamples.every(valid)));
}
async function compare(entries,current,limit,data,seed=42,options={}) {
 const r=await run(entries,current,limit,data,seed,options);
 assertSelection(r.result.downloads,reference(entries,current,limit,data,seed));
 assert.equal(new Set(r.calls.filter(e=>e.pass===1).map(e=>e.key)).size,new Set(entries.map(e=>e.key)).size);
 assert.equal(r.rngCalls,new Set(entries.map(e=>e.ip)).size-1);
 for(const e of current)if(valid(data.get(e.key)[0]))assert(r.calls.some(c=>c.key===e.key&&c.pass===2),'passing current entries always receive a second check');
 return r;
}
test('all 1280 entries receive a first probe while provably unnecessary second probes are skipped',async t=>{
 const entries=Array.from({length:1280},(_,i)=>entry(i)),current=entries.slice(-10);
 const data=new Map(entries.map((e,i)=>[e.key,[sample(100+i),sample(110+i)]]));
 const r=await compare(entries,current,160,data);
 const first=r.calls.filter(e=>e.pass===1).length,second=r.calls.filter(e=>e.pass===2).length;
 assert.equal(first,1280);assert(second<250);assert.equal(r.result.downloads.length,160);
 assert.equal(r.result.downloads.filter(e=>e.downloadReason==='current').length,10);
 assert.equal(r.result.downloads.filter(e=>e.downloadReason==='latency').length,120);
 assert.equal(r.result.downloads.filter(e=>e.downloadReason==='exploration').length,30);
 assert(r.result.downloads.filter(e=>e.downloadReason==='exploration').some(e=>e.n>1000));
 t.diagnostic(JSON.stringify({synthetic:true,uniqueCandidates:1280,fullDoubleRequests:2560,firstRequests:first,secondRequests:second,requestsSaved:2560-first-second,sameReferenceSelection:true}));
});
test('many independent data and exploration seeds match exhaustive double-probe reference selection',async()=>{
 const entries=Array.from({length:1280},(_,i)=>entry(i)),current=entries.slice(0,10);
 for(let seed=1;seed<=24;seed++)await compare(entries,current,160,staticData(entries,seed),seed*1009);
});
test('equal first bounds cannot discard possible ties and use slower-second/key ordering',async()=>{
 const entries=Array.from({length:240},(_,i)=>entry(i)),current=entries.slice(-10);
 const data=new Map(entries.map((e,i)=>[e.key,[sample(100),sample(100+(i%11))]]));
 const r=await compare(entries,current,160,data);
 assert.equal(new Set(r.calls.filter(e=>e.pass===2).map(e=>e.key)).size,entries.length);
});
test('when fewer than the limit pass, every remaining second check is exhausted and fast/exploration budgets shrink',async()=>{
 const entries=Array.from({length:240},(_,i)=>entry(i)),current=entries.slice(-10);
 for(const count of [159,70,9,0]) {
  const data=new Map(entries.map((e,i)=>[e.key,[sample(100+i),i<count?sample(110+i):{status:0,error:'timeout',ms:4000}]]));
  const r=await compare(entries,current,160,data,13);
  assert.equal(new Set(r.calls.filter(e=>e.pass===2).map(e=>e.key)).size,entries.length);
  assert.equal(r.result.downloads.length,count);
  assert.equal(r.result.downloads.filter(e=>e.downloadReason==='exploration').length,Math.floor(count/5));
 }
});
test('first or second failures free current reservations, and same-IP alternatives retain current preference',async()=>{
 const entries=Array.from({length:80},(_,i)=>entry(i)),current=entries.slice(0,4);
 const alternate=[entry(0,2053),entry(1,2053),entry(2,2053),entry(3,2053)];entries.push(...alternate);current.push(alternate[3]);
 const data=new Map(entries.map((e,i)=>[e.key,[sample(500+i),sample(510+i)]]));
 data.set(current[0].key,[sample(5),{status:503,ms:5}]);data.set(alternate[0].key,[sample(5),sample(6)]);
 data.set(current[1].key,[sample(700),sample(710)]);data.set(alternate[1].key,[sample(1),sample(2)]);
 data.set(current[2].key,[{status:0,error:'timeout',ms:4000},sample(1)]);data.set(alternate[2].key,[sample(7),sample(8)]);
 data.set(current[3].key,[sample(9),sample(10)]);data.set(alternate[3].key,[sample(8),sample(9)]);
 const r=await compare(entries,current,40,data,71);
 const keys=new Set(r.result.downloads.map(e=>e.key));
 for(const e of [alternate[0],current[1],alternate[2],alternate[3]])assert(keys.has(e.key));
 assert(!keys.has(alternate[1].key));assert(!keys.has(current[3].key));
 assert(!r.calls.some(e=>e.key===current[2].key&&e.pass===2));
});
test('exploration priorities are assigned once per unique IP instead of giving extra ports extra lottery tickets',async()=>{
 const base=Array.from({length:100},(_,i)=>entry(i));
 const repeated=base.concat(Array.from({length:20},(_,i)=>entry(i+70,2053)));
 const data=new Map(repeated.map((e,i)=>[e.key,[sample(100+e.n),sample(110+e.n)]]));
 for(let seed=100;seed<110;seed++) {
  const a=await compare(base,[],40,data,seed),b=await compare(repeated,[],40,data,seed);
  assert.deepEqual(a.result.downloads.map(e=>e.ip),b.result.downloads.map(e=>e.ip));
  assert.equal(a.rngCalls,b.rngCalls);
 }
});
test('all supported candidate limits and more-current-than-slots boundaries retain reference behavior',async()=>{
 const entries=Array.from({length:1280},(_,i)=>entry(i)),data=staticData(entries,501);
 for(const limit of [40,80,160,320,1024])await compare(entries,entries.slice(0,10),limit,data,limit);
 const allPassing=new Map(entries.map((e,i)=>[e.key,[sample(100+i),sample(110+i)]]));
 const r=await compare(entries,entries.slice(0,80),40,allPassing,52);
 assert.equal(r.result.downloads.length,40);assert(r.result.downloads.every(e=>e.downloadReason==='current'));
});
test('unknown, non-finite, non-204 and failed second results cannot be admitted',async()=>{
 const entries=Array.from({length:100},(_,i)=>entry(i)),data=new Map(entries.map(e=>[e.key,[sample(50+e.n),sample(60+e.n)]]));
 const invalid=[undefined,null,{},sample(0),sample(NaN),sample(Infinity),sample('20'),{status:200,ms:1},{status:204,ms:1,error:'timeout'}];
 invalid.forEach((s,i)=>data.set(entries[i].key,[s,sample(1)]));
 invalid.forEach((s,i)=>data.set(entries[i+invalid.length].key,[sample(1),s]));
 const r=await compare(entries,entries.slice(0,10),40,data);
 assert(r.result.downloads.every(e=>e.n>=invalid.length*2));
 for(const e of entries.slice(0,invalid.length))assert(!r.calls.some(c=>c.key===e.key&&c.pass===2));
});
test('an undefined second response stays failed and is never silently scheduled as an untested entry',async()=>{
 const entries=Array.from({length:80},(_,i)=>entry(i));
 const data=new Map(entries.map(e=>[e.key,[sample(100+e.n),undefined]]));
 const r=await compare(entries,entries.slice(0,10),40,data);
 assert.equal(r.result.downloads.length,0);assert.equal(r.result.stats.secondRequests,80);
 assert.equal(r.result.stats.skippedSecond,0);
});
test('adaptive first-pass degradation is rechecked at base concurrency before selective admission',async()=>{
 const entries=Array.from({length:320},(_,i)=>entry(i)),current=entries.slice(-10);
 const data=new Map(entries.map(e=>[e.key,[sample(100+e.n/100),sample(105+e.n/100)]]));
 const r=await compare(entries,current,160,data,42,{settings:{maxConcurrency:16},probe:async(e,pass,event)=>
  pass===1&&event.active>8?{status:0,error:'timeout',ms:4000}:{...data.get(e.key)[pass-1]}});
 assert(r.result.stats.backoffs>0);assert(r.result.stats.rechecked>0);assert(r.peak>8&&r.peak<=16);
 assert.equal(r.result.stats.secondConcurrency,r.result.stats.firstConcurrency);
 assert.equal(r.peakSecond,r.result.stats.firstConcurrency);
 assert(r.calls.filter(e=>e.pass===1).length>entries.length);
});
test('second-pass concurrency inherits the last completed first-pass width rather than the next planned width',async()=>{
 for(const [count,expected] of [[64,8],[128,12],[192,16]]) {
  const entries=Array.from({length:count},(_,i)=>entry(i)),data=new Map(entries.map(e=>[e.key,[sample(100),sample(100)]]));
  const r=await compare(entries,[],40,data,42,{settings:{maxConcurrency:16}});
  assert.equal(r.result.stats.firstConcurrency,expected);assert.equal(r.result.stats.secondConcurrency,expected);
  assert.equal(r.peakSecond,expected);
 }
 const entries=Array.from({length:64},(_,i)=>entry(i)),data=new Map(entries.map(e=>[e.key,[sample(100),sample(100)]]));
 for(const [requested,expected] of [[4,4],[100,16]]) {
  const r=await compare(entries,[],40,data,42,{settings:{maxConcurrency:16,secondConcurrency:requested}});
  assert.equal(r.result.stats.secondConcurrency,expected);assert.equal(r.peakSecond,expected);
 }
});
test('cancellation, ownership loss and network changes reject only after every in-flight probe drains',async()=>{
 const entries=Array.from({length:240},(_,i)=>entry(i)),current=entries.slice(-10);
 const data=new Map(entries.map(e=>[e.key,[sample(100+e.n),sample(110+e.n)]]));
 for(const pass of [1,2])for(const message of ['已取消，未发布结果','本轮已停止或被新任务替代','检测到网络变化，本轮结果已丢弃']) {
  let rejected=false;
  await assert.rejects(()=>run(entries,current,160,data,42,{probe:async(e,p)=>{
   if(p===pass&&!rejected){rejected=true;throw new Error(message);}return {...data.get(e.key)[p-1]};
  }}),error=>error.message===message);
 }
});
