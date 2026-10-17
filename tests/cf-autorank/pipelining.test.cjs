const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs'),premiumPage=require('./premium-fixture.cjs');

// Synthetic virtual-clock scenarios only: no network, backend or installed
// Surge configuration. Every response is a fixed function of (IP, kind, pass
// or per-IP ordinal), independent of when or in which order it is requested.
function frozen(version) {
 const text=fs.readFileSync(path.join(__dirname,'../../scripts/CF-AutoRank-'+version+'.js'),'utf8'),context=vm.createContext({});
 vm.runInContext(text.slice(0,text.lastIndexOf('(async function () {')),context);return context.CFRankCore;
}
function clock() {
 let now=1000000,queue=[],scheduled=false;
 function pump(){if(scheduled)return;scheduled=true;setImmediate(()=>{
  scheduled=false;if(!queue.length)return;now=Math.min(...queue.map(x=>x.at));
  const ready=queue.filter(x=>x.at===now);queue=queue.filter(x=>x.at!==now);ready.forEach(x=>x.resolve());if(queue.length)pump();
 });}
 return {now:()=>now,wait:ms=>new Promise(resolve=>{queue.push({at:now+ms,resolve});pump();})};
}
function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
const PROFILES={
 // Lossy path: many 4 s light timeouts; Premium pages slower than small screens.
 lossy:{lightFail:350,lightFail2:80,lightOk:[250,900],premium:[1500,1500],blocked:100,screen:[400,1600],full:[1200,5000],stable:[300,400],exit:[400,300]},
 clean:{lightFail:50,lightFail2:20,lightOk:[150,500],premium:[900,800],blocked:30,screen:[300,700],full:[900,2500],stable:[200,200],exit:[300,200]},
 // Most Premium pages unavailable: ranked checks must go much deeper.
 scarce:{lightFail:350,lightFail2:80,lightOk:[250,900],premium:[1500,1500],blocked:600,screen:[400,1600],full:[1200,5000],stable:[300,400],exit:[400,300]}
};
function simulate(core,profile,salt='') {
 const p=PROFILES[profile],f=fixture(),time=clock(),original=f.env.probe,counts=new Map(),kinds={},events=[],inflight=new Set();
 let active=0,fullActive=0,overlaps=0,peakSmall=0;
 f.opts.limit=160;f.env.now=time.now;f.env.sleep=time.wait;
 f.env.probe=async spec=>{
  const ip=/CF-Probe-(\d+\.\d+\.\d+\.\d+)-/.exec(spec.descriptor)[1];
  const range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range),size=range?Number(range[2])-Number(range[1])+1:0;
  const kind=spec.url.includes('cf_rank_light=')?'light':size>131072?'full':size?'screen':spec.url.includes('/premium?')?'premium':spec.url.includes('ipify')?'exit':'stable';
  const pass=kind==='light'?Number(/-p([12])-/.exec(spec.url)[1]):0,id=ip+'|'+kind+'|'+pass,ordinal=(counts.get(id)||0)+1;counts.set(id,ordinal);
  kinds[kind]=(kinds[kind]||0)+1;
  assert(!inflight.has(ip),'one node never has parallel requests');inflight.add(ip);
  if(kind==='full'&&active||kind!=='full'&&fullActive)overlaps++;
  active++;if(kind==='full')fullActive++;if(['premium','stable','exit'].includes(kind))peakSmall=Math.max(peakSmall,active);
  const h=hash(salt+ip+'|'+kind),hp=hash(salt+id+'|'+ordinal),pick=(r,x)=>r[0]+x%r[1];
  let ms,failed=false;
  if(kind==='light'){failed=(pass===1?h:hp)%1000<(pass===1?p.lightFail:p.lightFail2);ms=failed?4000:pick(p.lightOk,h)+(pass===2?hp%150:0);}
  else ms=pick(p[kind],kind==='screen'?h:hp);
  const event={ip,kind,ordinal,startedAt:time.now()};events.push(event);
  try {
   await time.wait(ms);
   if(failed)return {status:0,error:'timeout',ms,bytes:0,headers:{}};
   const r=await original(spec);r.ms=ms;
   if(kind==='premium'&&h%1000<p.blocked)return {...r,data:premiumPage({unavailable:true})};
   return r;
  }finally{event.finishedAt=time.now();active--;if(kind==='full')fullActive--;inflight.delete(ip);}
 };
 return {f,time,kinds,events,metrics:()=>({active,fullActive,overlaps,peakSmall})};
}
async function pair(profile,salt) {
 const old=simulate(frozen('0.1.22'),profile,salt),next=simulate(C,profile,salt);
 const a=await frozen('0.1.22').execute(old.f.env,old.f.opts,pools);
 const b=await C.execute(next.f.env,next.f.opts,pools);
 return {a,b,old,next};
}

test('0.1.23 publishes the same top ten with the same conservative scores as frozen 0.1.22, in less simulated time',async t=>{
 for(const profile of Object.keys(PROFILES))for(const salt of ['','s1','s2']) {
  const {a,b,old,next}=await pair(profile,salt);
  assert(a.verified&&b.verified);
  assert.deepEqual(b.selected.map(e=>e.key),Array.from(a.selected,e=>e.key),profile+salt+': same ten endpoints in the same order');
  assert.deepEqual(b.selected.map(e=>e.score),Array.from(a.selected,e=>e.score));
  assert.deepEqual(b.selected.map(e=>e.samples.map(s=>s.mbps)),Array.from(a.selected,e=>Array.from(e.samples,s=>s.mbps)));
  assert.deepEqual(b.downloadCandidates.map(e=>e.key),Array.from(a.downloadCandidates,e=>e.key),'same 160 download candidates');
  for(const e of b.selected){assert.equal(e.samples.length,2);assert(e.samples.every(s=>s.valid));assert(P.qualified(e.premium,b.finishedAt));}
  const m=next.metrics();assert.equal(m.active,0);assert.equal(m.overlaps,0);assert(m.peakSmall<=4);
  assert.equal(next.kinds.full,old.kinds.full,'large downloads unchanged');
  assert(next.kinds.premium<old.kinds.premium,'fewer Premium page loads');
  const oldSeconds=(a.finishedAt-a.startedAt)/1000,newSeconds=(b.finishedAt-b.startedAt)/1000;
  assert(newSeconds<oldSeconds*0.9,profile+salt+': at least 10% faster');
  t.diagnostic(JSON.stringify({synthetic:true,profile,salt,oldSeconds,newSeconds,oldPremium:old.kinds.premium,newPremium:next.kinds.premium,oldScreens:old.kinds.screen,newScreens:next.kinds.screen,lightRequests:[old.kinds.light,next.kinds.light]}));
 }
});

test('rankedPipeline admits exactly the first passes in order and never examines beyond a possible need',async()=>{
 for(let seed=1;seed<=40;seed++) {
  const items=Array.from({length:60},(_,i)=>i),passes=new Set(items.filter(i=>hash(seed+':'+i)%3!==0));
  const started=[],accepted=[];let active=0,peak=0;
  const needed=1+seed%24,width=1+seed%5;
  await C.rankedPipeline(items,width,needed,async i=>{
   started.push(i);active++;peak=Math.max(peak,active);
   await new Promise(r=>setTimeout(r,hash(seed+'/'+i)%5));active--;
   return passes.has(i)?{i}:null;
  },async(i,index,value)=>{assert.equal(value.i,i);accepted.push(i);active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;});
  const expected=items.filter(i=>passes.has(i)).slice(0,needed);
  assert.deepEqual(accepted.slice().sort((a,b)=>a-b),expected);
  assert.deepEqual(started,started.slice().sort((a,b)=>a-b),'dispatched in rank order');
  const last=expected.at(-1);assert(started.every(i=>i<=last)||expected.length<needed,'nothing beyond the last needed pass');
  assert(peak<=width);
 }
});

test('rankedPipeline and gatedPool drain in-flight work before rejecting',async()=>{
 let active=0;
 await assert.rejects(()=>C.rankedPipeline(Array.from({length:20},(_,i)=>i),4,10,async i=>{
  active++;try{await new Promise(r=>setTimeout(r,3));if(i===2)throw new Error('stop');return {i};}finally{active--;}
 }),/stop/);
 assert.equal(active,0);
 await assert.rejects(()=>C.gatedPool(Array.from({length:20},(_,i)=>i),4,()=>true,async i=>{
  active++;try{await new Promise(r=>setTimeout(r,3));if(i===5)throw new Error('halt');}finally{active--;}
 }),/halt/);
 assert.equal(active,0);
});

test('pipelined first pass keeps every request within its batch width and removes batch-tail idle time',async t=>{
 const entries=Array.from({length:1280},(_,i)=>{const ip=C.numberIP(C.ipNumber('104.16.0.0')+i+1);return {ip,port:443,key:ip+':443'};});
 const latency=(e,pass)=>{const h=hash(e.key+'|'+pass);return h%100<35?null:250+h%900;};
 async function run(core) {
  const time=clock(),open=new Set();let active=0,peak=0;const seen=new Map();
  const index=new Map(entries.map((e,i)=>[e.key,i]));
  const result=await core.selectiveLightScreen(entries,[],160,core.LIGHT_SCREEN.lite,async(e,pass)=>{
   const record={key:e.key,pass,max:0};open.add(record);active++;peak=Math.max(peak,active);
   for(const r of open)r.max=Math.max(r.max,active);
   const ms=latency(e,pass);await time.wait(ms===null?4000:ms);
   open.delete(record);active--;if(pass===1)seen.set(e.key,record.max); // the retained (last) first measurement
   return ms===null?{status:0,error:'timeout',ms:4000}:{status:204,ms};
  },async()=>{},(()=>{let s=7;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};})());
  return {result,seconds:(time.now()-1000000)/1000,peak,seen,index};
 }
 const a=await run(frozen('0.1.22')),b=await run(C);
 assert.deepEqual(b.result.downloads.map(e=>e.key),Array.from(a.result.downloads,e=>e.key));
 // Same degraded batch is detected; results taken ahead of it are discarded and remeasured.
 assert.equal(b.result.stats.backoffs,a.result.stats.backoffs);
 assert.deepEqual(b.result.stats.batches.filter(x=>x.rechecked).map(x=>x.offset),Array.from(a.result.stats.batches.filter(x=>x.rechecked),x=>x.offset));
 assert.equal(b.result.stats.firstRequests,a.result.stats.firstRequests+(b.result.stats.discardedAhead||0));
 // The last batch record per offset is the width its retained results were taken at.
 const widths=new Map(b.result.stats.batches.map(x=>[x.offset,x.concurrency]));
 for(const [key,max] of b.seen){const offset=Math.floor(b.index.get(key)/64)*64;assert(max<=widths.get(offset),'request above its batch width');}
 assert(b.peak<=16);assert(b.seconds<a.seconds*0.85);
 t.diagnostic(JSON.stringify({synthetic:true,entries:1280,timeouts:'35%',oldLightSeconds:a.seconds,newLightSeconds:b.seconds,sameDownloads:true}));
});
