const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../../src/cf-autorank/core.js');
const {fixture,pools}=require('./core-fixture.cjs');
const premiumPage=require('./premium-fixture.cjs');
function clock() {
 let now=1000000,queue=[],scheduled=false;
 function pump(){if(scheduled)return;scheduled=true;setImmediate(()=>{
  scheduled=false;if(!queue.length)return;
  now=Math.min(...queue.map(x=>x.at));const ready=queue.filter(x=>x.at===now);queue=queue.filter(x=>x.at!==now);
  ready.forEach(x=>x.resolve());if(queue.length)pump();
 });}
 return {now:()=>now,wait:ms=>new Promise(resolve=>{queue.push({at:now+ms,resolve});pump();})};
}
function simulated(options={}) {
 const f=fixture(),original=f.env.probe,time=clock(),progress=f.env.progress;
 let active=0,fullActive=0,stage='',maxActive=0,peakFull=0,overlaps=0;
 const peaks={},events=[],perNode=new Map();
 f.opts.limit=160;f.env.now=time.now;f.env.sleep=time.wait;
 f.env.progress=async p=>{stage=p.stage;await progress(p);};
 f.env.probe=async spec=>{
  const match=/CF-Probe-(\d+\.\d+\.\d+\.\d+)-(\d+)/.exec(spec.descriptor),ip=match[1];
  const n=ip.split('.').reduce((a,b)=>a*31+Number(b),0)>>>0;
  const range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);
  const size=range?Number(range[2])-Number(range[1])+1:0;
  const kind=spec.url.includes('cf_rank_light=')?'light':size>131072?'full':size?'screen':spec.url.includes('/premium?')?'premium':spec.url.includes('ipify')?'exit':'stable';
  if(kind==='full'&&active||kind!=='full'&&fullActive)overlaps++;
  active++;if(kind==='full')fullActive++;
  peakFull=Math.max(peakFull,fullActive);maxActive=Math.max(maxActive,active);
  peaks[kind]=Math.max(peaks[kind]||0,active);
  assert(!perNode.has(ip),'only one request per node can be active');perNode.set(ip,true);
  let ms=kind==='light'?200+n%51:kind==='full'?1000+n%2500:kind==='screen'?300+n%700:kind==='premium'?600:250;
  const failed=kind==='light'&&options.mixed&&n%2===0;
  if(failed)ms=4000;
  if(kind==='light'&&options.congested&&active>8)ms=900;
  events.push({kind,ip,stage,at:time.now()});
  try {
   await time.wait(ms);const result=await original(spec);result.ms=ms;
   if(failed)return {status:0,error:'timeout',ms};
   if(kind==='premium'&&options.mixed&&n%3!==0)return {...result,data:premiumPage({unavailable:true})};
   return result;
  }finally{active--;if(kind==='full')fullActive--;perNode.delete(ip);}
 };
 return {...f,time,events,metrics:()=>({active,fullActive,maxActive,peakFull,overlaps,peaks})};
}
function baseline(version='0.1.15') {
 const text=fs.readFileSync(path.join(__dirname,'../../scripts/CF-AutoRank-'+version+'.js'),'utf8');
 const context=vm.createContext({});vm.runInContext(text.slice(0,text.lastIndexOf('(async function () {')),context);
 return context.CFRankCore;
}
// Historical 0.1.16 scheduling comparison stays frozen: later releases change
// light selection and its random exploration order. Current-flow invariants
// are exercised below and in light-integration/selective-light tests.
test('published 0.1.16 scheduling retains the frozen 0.1.15 synthetic top ten',async t=>{
 for(const scenario of ['healthy','mixed','congested']) {
  const old=simulated({mixed:scenario==='mixed',congested:scenario==='congested'}),next=simulated({mixed:scenario==='mixed',congested:scenario==='congested'});
  const a=await baseline().execute(old.env,old.opts,pools),b=structuredClone(await baseline('0.1.16').execute(next.env,next.opts,pools));
  assert(a.verified&&b.verified);
  assert.deepEqual(Array.from(a.downloadCandidates,e=>e.key),b.downloadCandidates.map(e=>e.key));
  assert.deepEqual(Array.from(a.selected,e=>e.key),b.selected.map(e=>e.key));
  assert.deepEqual(Array.from(a.selected,e=>e.score),b.selected.map(e=>e.score));
  assert.equal(b.premium.verified,10);assert(b.selected.every(e=>e.premium.samples.length===3));
  const m=next.metrics();assert.equal(m.active,0);assert.equal(m.overlaps,0);assert.equal(m.peakFull,1);assert(m.maxActive<=16);
  assert(m.peaks.premium<=4&&m.peaks.exit<=4&&m.peaks.stable<=4&&m.peaks.screen<=3);
  assert(Object.values(b.stageTimings).every(ms=>Number.isFinite(ms)&&ms>=0));
  assert.equal(Object.values(b.stageTimings).reduce((a,b)=>a+b,0),b.finishedAt-b.startedAt);
  if(scenario==='congested'){assert.equal(b.lightScreen.backoffs,2);assert(b.lightScreen.rechecked>0);}
  else assert(next.time.now()-1000000<(old.time.now()-1000000)*0.85);
  t.diagnostic(JSON.stringify({scenario,oldSeconds:(old.time.now()-1000000)/1000,newSeconds:(next.time.now()-1000000)/1000,sameTopTen:true,oldSampleMB:a.bytes/1e6,newSampleMB:b.bytes/1e6,backoffs:b.lightScreen.backoffs}));
 }
});
test('Premium rejection prevents all large downloads for that entry',async()=>{
 const f=simulated({mixed:true}),r=await C.execute(f.env,f.opts,pools);
 const downloaded=new Set(f.events.filter(e=>e.kind==='full').map(e=>e.ip));
 for(const ip of downloaded){const n=ip.split('.').reduce((a,b)=>a*31+Number(b),0)>>>0;assert.equal(n%3,0);}
 assert.equal(r.premium.verified,10);assert(r.bytes<117000000);assert.equal(f.metrics().overlaps,0);
});
test('failed concurrent final verification drains in-flight probes and never publishes',async()=>{
 const f=simulated(),original=f.env.probe,counts=new Map();
 f.env.probe=async spec=>{
  const r=await original(spec);
  if(spec.url.includes('/premium?')) {
   const n=(counts.get(spec.descriptor)||0)+1;counts.set(spec.descriptor,n);
   if(n===3)return {...r,data:premiumPage({unavailable:true})};
  }
  return r;
 };
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/Premium 发布前复核未通过/);
 assert.equal(f.metrics().active,0);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
});
