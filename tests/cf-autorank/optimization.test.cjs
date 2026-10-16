const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../../src/cf-autorank/core.js');
const P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs');
const premiumPage=require('./premium-fixture.cjs');

// No network, backend, installed Surge configuration, or wall-clock waits are
// used. Each request receives an immutable synthetic response keyed by IP and
// its per-IP sample number, independently of the implementation's scheduling.
function virtualClock() {
 let now=1000000,queue=[],scheduled=false;
 function pump(){if(scheduled)return;scheduled=true;setImmediate(()=>{
  scheduled=false;if(!queue.length)return;
  now=Math.min(...queue.map(x=>x.at));const ready=queue.filter(x=>x.at===now);
  queue=queue.filter(x=>x.at!==now);ready.forEach(x=>x.resolve());if(queue.length)pump();
 });}
 return {now:()=>now,wait:ms=>new Promise(resolve=>{queue.push({at:now+ms,resolve});pump();})};
}
function previousCore() {
 const text=fs.readFileSync(path.join(__dirname,'../../scripts/CF-AutoRank-0.1.16.js'),'utf8');
 const context=vm.createContext({});vm.runInContext(text.slice(0,text.lastIndexOf('(async function () {')),context);
 return context.CFRankCore;
}
function simulation(options={}) {
 const f=fixture(),time=virtualClock(),original=f.env.probe,progress=f.env.progress;
 const events=[],screened=[],perNode=new Set(),sampleCounts=new Map(),premiumCounts=new Map();
 let ranks=null,active=0,fullActive=0,smallActive=0,overlaps=0,peakFull=0,peakSmall=0,cancelled=false,delayed=false;
 const rank=ip=>{if(!ranks)ranks=new Map(screened.slice().sort((a,b)=>a.ms-b.ms).map((e,i)=>[e.ip,i]));return ranks.get(ip);};
 f.opts.limit=160;f.env.now=time.now;f.env.sleep=time.wait;f.env.cancelled=async()=>cancelled;
 f.env.progress=async p=>{
  await progress(p);
  if(options.oldPairs&&!delayed&&p.stage.startsWith('后备')){delayed=true;await time.wait(310000);}
 };
 f.env.probe=async spec=>{
  const ip=/CF-Probe-(\d+\.\d+\.\d+\.\d+)-/.exec(spec.descriptor)[1];
  const h=ip.split('.').reduce((a,b)=>((a*31)+Number(b))>>>0,0);
  const range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);
  const size=range?Number(range[2])-Number(range[1])+1:0;
  const kind=spec.url.includes('cf_rank_light=')?'light':size>131072?'full':size?'screen':spec.url.includes('/premium?')?'premium':spec.url.includes('ipify')?'exit':'stable';
  const small=['premium','exit','stable'].includes(kind);
  const ordinal=kind==='full'?(sampleCounts.get(ip)||0)+1:kind==='premium'?(premiumCounts.get(ip)||0)+1:0;
  if(kind==='full')sampleCounts.set(ip,ordinal);if(kind==='premium')premiumCounts.set(ip,ordinal);
  assert(!perNode.has(ip),'same-node probes must remain sequential');perNode.add(ip);
  if(kind==='full'&&active||kind!=='full'&&fullActive)overlaps++;
  active++;if(kind==='full')fullActive++;if(small)smallActive++;
  peakFull=Math.max(peakFull,fullActive);peakSmall=Math.max(peakSmall,smallActive);
  const r=['full','premium','stable','exit'].includes(kind)?rank(ip):null;
  let ms=kind==='light'?200+h%71:kind==='screen'?200+(h%500)*2:kind==='premium'?450+(r%4)*70:kind==='exit'?200+(r%3)*50:100+r*5;
  if(kind==='full') {
   if(options.equal)ms=2000;
   else if(options.crossing)ms=ordinal===1?600+(23-r)*55:500+((r*7)%24)*95;
   else ms=700+r*140+(ordinal===2?100:0);
  }
  if(options.equal&&kind==='stable')ms=100+(23-r)*5;
  if(options.completeTie&&kind==='stable')ms=100;
  const event={ip,kind,ordinal,rank:r,startedAt:time.now(),ms};events.push(event);
  try {
   await time.wait(ms);const response={...await original(spec),ms};
   if(kind==='screen')screened.push({ip,ms});
   if(kind==='premium'&&options.reserve&&r>=7&&r<24)return {...response,data:premiumPage({unavailable:true})};
   if(kind==='full'&&options.invalidFirst&&[0,5,23].includes(r)&&ordinal===1)return {...response,status:503,bytes:0};
   if(kind==='full'&&options.invalidFirst&&r===1&&ordinal===2)return {...response,status:503,bytes:0};
   if(kind==='full'&&options.invalidReserve&&((r===24&&ordinal===1)||(r===25&&ordinal===2)))return {...response,status:503,bytes:0};
   if(kind==='full'&&options.initialFirstFailures&&r>=7&&r<24&&ordinal===1)return {...response,status:503,bytes:0};
   if(kind==='full'&&options.initialSecondFailures&&r>=9&&r<24&&ordinal===2)return {...response,status:503,bytes:0};
   if(kind==='full'&&options.partialFirst&&r===3&&ordinal===1)return {...response,error:'timeout',bytes:size/2};
   if(kind==='premium'&&ordinal===3&&options.finalFailure)return {...response,data:premiumPage({unavailable:true})};
   if(options.cancelAt==='first-premium'&&kind==='premium'&&ordinal===1)cancelled=true;
   if(options.cancelAt==='final-premium'&&kind==='premium'&&ordinal===3)cancelled=true;
   return response;
  }finally{event.finishedAt=time.now();active--;if(kind==='full')fullActive--;if(small)smallActive--;perNode.delete(ip);}
 };
 return {...f,events,sampleCounts,premiumCounts,time,rank,metrics:()=>({active,fullActive,smallActive,overlaps,peakFull,peakSmall})};
}
function quality(result,f) {
 assert(result.verified);assert.equal(result.candidateCount,1280);assert.equal(result.downloadCandidateCount,160);
 assert.equal(result.selected.length,10);assert.equal(new Set(result.selected.map(e=>e.ip)).size,10);
 for(const e of result.selected) {
  assert.equal(e.samples.length,2);assert(e.samples.every(s=>s.valid));
  assert.equal(e.score,Math.min(...e.samples.map(s=>s.mbps)));
  assert(P.qualified(e.premium,result.finishedAt));
  const trace=f.events.filter(x=>x.ip===e.ip);
  assert.equal(trace.filter(x=>x.kind==='full').length,2);
  const final=trace.filter(x=>x.kind==='premium').at(-1),exit=trace.filter(x=>x.kind==='exit');
  assert.equal(exit.length,2);assert(exit.every(x=>x.finishedAt<=final.startedAt));
 }
 const m=f.metrics();assert.equal(m.active,0);assert.equal(m.fullActive,0);assert.equal(m.smallActive,0);
 assert.equal(m.overlaps,0);assert.equal(m.peakFull,1);assert(m.peakSmall<=4);
 assert(Object.values(result.stageTimings).every(ms=>Number.isFinite(ms)&&ms>=0));
 assert.equal(Object.values(result.stageTimings).reduce((a,b)=>a+b,0),result.finishedAt-result.startedAt);
}
async function compare(options,t,label) {
 const old=simulation(options),next=simulation(options);
 const a=await previousCore().execute(old.env,old.opts,pools),b=await C.execute(next.env,next.opts,pools);
 quality(b,next);
 assert.deepEqual(Array.from(a.downloadCandidates,e=>e.key),b.downloadCandidates.map(e=>e.key));
 assert.deepEqual(Array.from(a.selected,e=>e.key),b.selected.map(e=>e.key));
 assert.deepEqual(Array.from(a.selected,e=>e.score),b.selected.map(e=>e.score));
 assert.deepEqual(Array.from(a.selected,e=>Array.from(e.samples,s=>s.mbps)),b.selected.map(e=>e.samples.map(s=>s.mbps)));
 if(t)t.diagnostic(JSON.stringify({scenario:label,baseline:'0.1.16',oldSeconds:(a.finishedAt-a.startedAt)/1000,newSeconds:(b.finishedAt-b.startedAt)/1000,oldSampleMB:a.bytes/1e6,newSampleMB:b.bytes/1e6,oldFullRequests:old.events.filter(e=>e.kind==='full').length,newFullRequests:next.events.filter(e=>e.kind==='full').length,sameTopTen:true}));
 return {a,b,old,next};
}
test('two-pass bounded retest preserves the frozen 0.1.16 top ten with cheaper synthetic scheduling',async t=>{
 const {a,b,old,next}=await compare({},t,'healthy');
 assert(b.refinement.skippedByBound>0);assert.equal(b.refinement.firstSamples,24);
 assert(b.bytes<a.bytes);assert(b.finishedAt-b.startedAt<a.finishedAt-a.startedAt);
 assert(next.events.filter(e=>e.kind==='full').length<old.events.filter(e=>e.kind==='full').length);
});
test('crossing first and second sample strengths retain exact conservative scores and winners',async t=>{
 await compare({crossing:true},t,'crossing-first-second');
});
test('equal first-sample upper bounds are all retested and final latency tie-breaking is preserved',async t=>{
 const {b}=await compare({equal:true},t,'equal-speed');
 assert.equal(b.refinement.skippedByBound,0);assert.equal(b.refinement.secondSamples,24);
 assert.deepEqual(b.selected.map(e=>e.latency),b.selected.map(e=>e.latency).slice().sort((a,b)=>a-b));
});
test('completely tied scores and latencies preserve the original finalist order',async t=>{
 const {b,next}=await compare({equal:true,completeTie:true},t,'complete-ties');
 assert.equal(b.refinement.skippedByBound,0);assert.equal(b.refinement.secondSamples,24);
 assert(b.selected.every(e=>e.score===8&&e.latency===100));
 assert.deepEqual(b.selected.map(e=>next.rank(e.ip)),Array.from({length:10},(_,i)=>i));
});
test('valid partial timeout downloads use their actual byte-based bound without being treated as failures',async t=>{
 const {b,next}=await compare({partialFirst:true},t,'valid-partial-sample');
 const partial=next.events.find(e=>e.kind==='full'&&e.rank===3);
 assert.equal(b.refinement.skippedInvalidFirst,0);
 assert.equal(next.sampleCounts.get(partial.ip),1);
 assert(!b.selected.some(e=>e.ip===partial.ip));
});
test('invalid first samples never receive a second while invalid second samples cannot create a cutoff',async t=>{
 const {b,next}=await compare({invalidFirst:true},t,'invalid-samples');
 assert.equal(b.refinement.skippedInvalidFirst,3);
 for(const [ip,count] of next.sampleCounts)if([0,5,23].includes(next.rank(ip)))assert.equal(count,1);
 assert(b.selected.every(e=>![0,1,5,23].includes(next.rank(e.ip))));
});
test('fewer than ten initial qualifiers use the same reserves and invalid reserve first samples short-circuit',async t=>{
 const {b,next}=await compare({reserve:true,invalidReserve:true},t,'reserve-recovery');
 assert.equal(b.supplement.added,3);assert.equal(b.supplement.examined,5);
 assert.equal(b.refinement.reserveSkippedInvalidFirst,1);
 const invalid=next.events.find(e=>e.kind==='full'&&e.rank===24);assert.equal(next.sampleCounts.get(invalid.ip),1);
 assert(b.selected.some(e=>next.rank(e.ip)>=24));
});
test('invalid initial first samples leaving seven valid nodes still trigger complete reserve recovery',async t=>{
 const {b}=await compare({initialFirstFailures:true},t,'first-sample-shortfall');
 assert.equal(b.refinement.skippedInvalidFirst,17);assert.equal(b.refinement.secondSamples,7);
 assert.equal(b.refinement.skippedByBound,0);assert.equal(b.supplement.added,3);
});
test('valid first but invalid second samples never count toward ten or enable premature pruning',async t=>{
 const {b}=await compare({initialSecondFailures:true},t,'second-sample-shortfall');
 assert.equal(b.refinement.skippedInvalidFirst,0);assert.equal(b.refinement.secondSamples,24);
 assert.equal(b.refinement.skippedByBound,0);assert.equal(b.supplement.added,1);
});
test('only the seven old evidence pairs refresh after a delayed reserve stage',async t=>{
 const {a,b,old,next}=await compare({reserve:true,oldPairs:true},t,'seven-old-pairs');
 assert.equal(a.premium.refreshed,10);assert.equal(b.premium.refreshed,7);
 for(const e of b.selected)assert.equal(next.premiumCounts.get(e.ip),next.rank(e.ip)<7?5:3);
 const premiumCount=f=>f.events.filter(e=>e.kind==='premium').length;
 assert.equal(premiumCount(old)-premiumCount(next),6);
});
test('failure and cancellation drain every concurrent request before rejecting and never publish',async()=>{
 for(const options of [{finalFailure:true},{cancelAt:'first-premium'},{cancelAt:'final-premium'}]) {
  const f=simulation(options);
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),/Premium .*未通过|取消/);
  assert.equal(f.metrics().active,0);assert.equal(f.metrics().fullActive,0);assert.equal(f.metrics().smallActive,0);
  assert(f.events.every(e=>Number.isFinite(e.finishedAt)));
  assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);assert.equal(f.metrics().overlaps,0);
 }
});
