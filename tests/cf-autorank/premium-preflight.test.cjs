const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs'),premiumPage=require('./premium-fixture.cjs');

function scenario(options={}) {
 const f=fixture(),probe=f.env.probe,progress=f.env.progress,now=f.env.now;
 const events=[],counts=new Map(),indices=new Map(),inflight=new Set();
 let stage='',elapsed=0,active=0,premiumActive=0,peakPremium=0,stopped=false;
 f.opts.limit=160;
 f.env.now=()=>now()+elapsed;
 f.env.cancelled=async()=>options.stop==='cancel'&&stopped;
 f.env.networkKey=()=>options.stop==='network'&&stopped?'new-network':'original-network';
 f.env.progress=async p=>{
  stage=p.stage;
  await progress(p);
 };
 f.env.probe=async spec=>{
  const key=spec.descriptor,range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);
  const size=range?Number(range[2])-Number(range[1])+1:0;
  const kind=spec.url.includes('/premium?')?'premium':size>C.MODES.lite.screenBytes?'full':size?'screen':spec.url.includes('cf_rank_light=')?'light':'other';
  let ordinal=0,index=null;
  if(kind==='premium'){
   if(!indices.has(key))indices.set(key,indices.size);
   index=indices.get(key);ordinal=(counts.get(key)||0)+1;counts.set(key,ordinal);
   premiumActive++;peakPremium=Math.max(peakPremium,premiumActive);
   assert.equal(spec.timeout,8);assert.equal(spec.headers['Cache-Control'],'no-cache');
   assert.match(spec.descriptor,/^CF-Probe-.* = trojan,/);
  }
  if(size)assert.equal(premiumActive,0,'Premium and downloads occupy separate phases');
  assert(!inflight.has(key),'one entry never has parallel requests');inflight.add(key);active++;
  const event={key,kind,ordinal,index,size,stage,startedAt:f.env.now()};events.push(event);
  try{
   await Promise.resolve();const result=await probe(spec);
   if(kind==='screen')event.mbps=result.bytes*8/result.ms/1000;
   if(kind!=='premium')return result;
   if(options.stop&&ordinal===1)stopped=true;
   const changed=options.reply&&options.reply({index,ordinal,stage});
   return {...result,ms:100+ordinal,...changed};
  }finally{
   event.finishedAt=f.env.now();active--;if(kind==='premium')premiumActive--;inflight.delete(key);
  }
 };
 return {...f,events,counts,indices,metrics:()=>({active,premiumActive,peakPremium})};
}
const blocked={data:premiumPage({unavailable:true})};
const lastScreen=f=>Math.max(...f.events.filter(e=>e.kind==='screen').map(e=>e.finishedAt));
// Screen rank: higher small-download speed first. Indices count first Premium
// samples, so index i is the i-th entry Premium reached in that order.
function rankedKeys(f){return f.events.filter(e=>e.kind==='premium'&&e.ordinal===1).map(e=>e.key);}
function assertFinalQuality(result,f){
 assert(result.verified);assert.equal(result.candidateCount,1280);assert.equal(result.downloadCandidateCount,160);
 assert.equal(result.selected.length,10);assert.equal(new Set(result.selected.map(e=>e.ip)).size,10);
 assert(result.selected.every(e=>P.qualified(e.premium,f.env.now())&&e.samples.length===2&&e.samples.every(s=>s.valid)));
 for(const e of result.selected){
  const key=[...f.indices.keys()].find(d=>d.startsWith('CF-Probe-'+e.ip+'-'+e.port+' ='));
  const trace=f.events.filter(e=>e.key===key),screen=trace.find(e=>e.kind==='screen'),full=trace.find(e=>e.kind==='full');
  assert(trace.some(e=>e.kind==='premium'&&e.ordinal===1&&e.startedAt>=lastScreen(f)));
  assert(trace.filter(e=>e.kind==='premium'&&e.finishedAt<=full.startedAt).length>=2);
  assert(trace.filter(e=>e.kind==='premium').at(-1).startedAt>=trace.filter(e=>e.kind==='full').at(-1).finishedAt);
 }
 assert.equal(f.metrics().active,0);assert.equal(f.metrics().premiumActive,0);assert(f.metrics().peakPremium<=4);
 assert.equal(f.posts.length,1);
}

test('all 160 are screened first, then Premium runs in screen-rank order only until 24 finalists exist',async()=>{
 const f=scenario(),r=await C.execute(f.env,f.opts,pools);assertFinalQuality(r,f);
 const first=f.events.filter(e=>e.kind==='premium'&&e.ordinal===1),screens=f.events.filter(e=>e.kind==='screen');
 assert.equal(screens.length,160);assert.equal(first.length,24);
 assert(Math.min(...first.map(e=>e.startedAt))>=lastScreen(f),'small screening finishes before any Premium page');
 assert.equal(r.downloadTestedCount,160);assert.equal(r.premium.preflight.reused,24);assert.equal(r.premium.preflight.refreshed,0);
 assert.equal(f.events.filter(e=>e.kind==='premium').length,24+24+10);
 assert.deepEqual(r.premium.preflight,{total:160,tested:24,passed:24,unavailable:0,unknown:0,reserveTested:0,notNeeded:136,skippedDownloads:0,reused:24,refreshed:0,ranked:true});
 // Premium reached exactly the highest small-download scores: no unchecked
 // entry screened faster than any entry that was checked.
 const checked=new Set(first.map(e=>e.key)),score=key=>screens.find(e=>e.key===key).mbps;
 const low=Math.min(...[...checked].map(score)),high=Math.max(...screens.filter(e=>!checked.has(e.key)).map(e=>e.mbps));
 assert(low>=high,'ranked Premium skipped a faster screened entry');
 assert.deepEqual(first.map(e=>score(e.key)),first.map(e=>score(e.key)).slice().sort((a,b)=>b-a));
});

test('unavailable, unknown, Lite, challenge, and transport failures are never retried, retested or admitted; the next ranks replace them',async()=>{
 const replies=[blocked,{data:'unknown page'},{data:premiumPage({lite:true})},{data:'before you continue to YouTube'},{error:'timeout',status:0,data:''}];
 const f=scenario({reply:({index,ordinal})=>ordinal===1&&index<5?replies[index]:null}),r=await C.execute(f.env,f.opts,pools);
 assertFinalQuality(r,f);assert.equal(r.downloadTestedCount,160);
 assert.equal(r.premium.preflight.unavailable,1);assert.equal(r.premium.preflight.unknown,4);
 assert.equal(r.premium.preflight.tested,29);assert.equal(r.premium.preflight.passed,24);assert.equal(r.premium.tested,24);
 for(const [key,index] of f.indices)if(index<5){assert.equal(f.counts.get(key),1);assert(!f.events.some(e=>e.key===key&&e.kind==='full'));assert(!r.selected.some(e=>key.startsWith('CF-Probe-'+e.ip+'-')));}
});

test('fewer than ten Premium qualifiers stop before any large download and preserve the backend',async()=>{
 const f=scenario({reply:({index})=>index>=9?blocked:null});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/Premium 首检合格 9\/10/);
 assert.equal(f.indices.size,160);assert(!f.events.some(e=>e.kind==='full'));assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
 assert.equal(f.progress.at(-1).premium.preflight.passed,9);assert.equal(f.metrics().active,0);
});

test('each finalist takes its two Premium samples back to back, so the first sample is always fresh for reuse',async()=>{
 const f=scenario(),r=await C.execute(f.env,f.opts,pools);assertFinalQuality(r,f);
 assert.equal(r.premium.preflight.refreshed,0);assert.equal(r.premium.preflight.reused,24);
 for(const key of rankedKeys(f)){
  const trace=f.events.filter(e=>e.key===key);
  const i=trace.findIndex(e=>e.kind==='premium'&&e.ordinal===1);
  assert.equal(trace[i+1].kind,'premium');assert.equal(trace[i+1].ordinal,2);
  assert(trace[i+1].startedAt-trace[i].finishedAt<P.MAX_AGE/2);
 }
});

test('a changed region between the pair is inconsistent and cannot be admitted from any rank',async()=>{
 const f=scenario({reply:({ordinal})=>ordinal>1?{data:premiumPage({region:'JP'})}:null});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/综合检查合格 0\/10/);
 assert(!f.events.some(e=>e.kind==='full'));assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
 assert.equal(f.progress.at(-1).premium.inconsistent,160);assert.equal(f.metrics().active,0);
});

test('first-check success never bypasses a failed second check or the strict final publication check',async()=>{
 for(const ordinal of [2,3]){
  const f=scenario({reply:e=>e.ordinal===ordinal?blocked:null});
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),ordinal===2?/综合检查合格 0\/10/:/Premium 发布前复核未通过.*明确不支持/);
  if(ordinal===2)assert(!f.events.some(e=>e.kind==='full'));
  else assert(f.progress.at(-1).premiumFinalFailures.every(e=>e.reason==='region_unavailable'&&!e.retryable));
  assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);assert.equal(f.metrics().active,0);
 }
});

test('cancellation and network changes during early Premium drain requests without large downloads or writing',async()=>{
 for(const stop of ['cancel','network']){
  const f=scenario({stop});await assert.rejects(()=>C.execute(f.env,f.opts,pools),/取消|网络变化/);
  assert(!f.events.some(e=>e.kind==='full'));assert(f.indices.size>0&&f.indices.size<=4);
  assert.equal(f.metrics().active,0);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
 }
});
