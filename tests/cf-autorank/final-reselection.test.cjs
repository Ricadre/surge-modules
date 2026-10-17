const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs'),page=require('./premium-fixture.cjs');

// Immutable per-node speed samples provide an independent ordering oracle.
// All traffic and backend writes are simulated; no installed profile is used.
function scenario(options={}) {
 const f=fixture({userChange:options.userChange}),probe=f.env.probe,progress=f.env.progress,now=f.env.now;
 const rank=new Map(),counts=new Map(),events=[],inflight=new Set();
 let stage='',elapsed=0,active=0,fullActive=0,overlaps=0,peakSmall=0,stopped=false,expired=false;
 f.opts.limit=160;f.env.now=()=>now()+elapsed;
 f.env.cancelled=async()=>options.stop==='cancel'&&stopped;
 f.env.networkKey=()=>options.stop==='network'&&stopped?'new':'original';
 f.env.progress=async p=>{
  stage=p.stage;
  if(options.oldPairs&&stage==='出口与 Premium 最终复核'&&!elapsed)elapsed=6*60*1000;
  if(stage==='补位第二次下载') {
   if(options.stop)stopped=true;
   if(options.expireConfirmed&&!expired){expired=true;elapsed+=11*60*1000;}
  }
  await progress(p);
 };
 f.env.probe=async spec=>{
  const key=spec.descriptor,range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);
  const bytes=range?Number(range[2])-Number(range[1])+1:0;
  const kind=bytes>C.MODES.lite.screenBytes?'full':bytes?'screen':spec.url.includes('/premium?')?'premium':spec.url.includes('ipify')?'exit':spec.url.includes('cf_rank_light=')?'light':'stable';
  if(kind==='screen'&&!rank.has(key))rank.set(key,rank.size);
  const r=rank.get(key),id=key+'|'+kind,ordinal=(counts.get(id)||0)+1;counts.set(id,ordinal);
  if(kind==='full'&&active||kind!=='full'&&fullActive)overlaps++;
  assert(!inflight.has(key));inflight.add(key);active++;if(kind==='full')fullActive++;
  if(['premium','exit','stable'].includes(kind))peakSmall=Math.max(peakSmall,active);
  const e={key,kind,rank:r,ordinal,stage,startedAt:f.env.now()};events.push(e);
  try {
   await Promise.resolve();const response=await probe(spec);
   if(kind==='screen')return {...response,ms:100+r*10};
   if(kind==='full') {
    if(ordinal===2&&options.invalidSecond&&options.invalidSecond.has(r))return {...response,status:503,bytes:0};
    // Eager scenario makes every initial first-sample bound competitive.
    let ms=400+r*20;
    if(ordinal===1){if(options.firstOverride&&options.firstOverride.has(r))ms=options.firstOverride.get(r);else if(options.eager)ms=100;}
    return {...response,ms};
   }
   if(kind==='premium'&&stage==='出口与 Premium 最终复核'&&options.denied&&options.denied.has(r))return {...response,data:page({unavailable:true})};
   return response;
  }finally {e.finishedAt=f.env.now();active--;if(kind==='full')fullActive--;inflight.delete(key);}
 };
 return {...f,rank,counts,events,metrics:()=>({active,fullActive,overlaps,peakSmall})};
}
function selectedRanks(r,f){return r.selected.map(e=>[...f.rank].find(([key])=>key.startsWith('CF-Probe-'+e.ip+'-'+e.port+' ='))[1]);}
function quality(r,f) {
 assert(r.verified);assert.equal(r.selected.length,10);assert.equal(new Set(r.selected.map(e=>e.ip)).size,10);
 assert.equal(r.candidateCount,1280);assert.equal(r.downloadCandidateCount,160);assert.equal(r.downloadTestedCount,160);
 assert(r.selected.every(e=>P.qualified(e.premium,f.env.now())&&e.samples.length===2&&e.samples.every(s=>s.valid)&&e.score===Math.min(...e.samples.map(s=>s.mbps))));
 assert.equal(f.posts.length,1);assert.equal(r.premium.verified,10);assert.equal(f.metrics().active,0);assert.equal(f.metrics().fullActive,0);
 assert.equal(f.metrics().overlaps,0);assert(f.metrics().peakSmall<=4);
 assert(r.supplement.refined<=24);assert(r.refinement.firstSamples<=24);assert(r.refinement.secondSamples<=24);
 for(const [id,count] of f.counts)if(id.endsWith('|full'))assert(count<=2,'no full sample is redownloaded');
 const firstLight=f.events.filter(e=>e.kind==='light'&&e.ordinal===1);assert.equal(firstLight.length,1280);
 assert.equal(f.events.filter(e=>e.kind==='screen').length,160);
 // Premium starts in screen-rank order and goes only as deep as needed, yet
 // every full download still follows two Premium samples for that entry.
 const initialPremium=f.events.filter(e=>e.kind==='premium'&&e.ordinal===1&&e.stage==='Premium 与稳定性检查');
 assert.deepEqual(initialPremium.map(e=>e.rank),initialPremium.map((e,i)=>i));
 assert(initialPremium.length>=24&&f.events.filter(e=>e.kind==='premium'&&e.ordinal===1).length<=160);
 for(const key of new Set(f.events.filter(e=>e.kind==='full').map(e=>e.key))) {
  const firstFull=f.events.find(e=>e.key===key&&e.kind==='full');
  assert(f.events.filter(e=>e.key===key&&e.kind==='premium'&&e.finishedAt<=firstFull.startedAt).length>=2);
 }
 for(const issue of r.premiumFinalFailures.filter(e=>e.discarded))assert(!r.selected.some(e=>e.key===issue.endpoint));
}

test('a final failure reuses already completed runner-up measurements without repeating downloads or healthy final checks',async()=>{
 const f=scenario({eager:true,denied:new Set([0,1])}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[2,3,4,5,6,7,8,9,10,11]);
 assert.equal(r.finalSelection.rejected,2);assert.equal(r.finalSelection.replacements,2);assert.equal(r.finalSelection.examined,12);
 assert.equal(r.finalSelection.resumedDownloads,0);assert.equal(r.supplement.refined,0);
 assert.equal(f.events.filter(e=>e.kind==='full').length,48);
 for(const [key,rank] of f.rank)if(rank<12){assert.equal(f.counts.get(key+'|premium'),3);assert.equal(f.counts.get(key+'|exit'),2);}
});

test('removing a winner resumes the necessary second sample rather than treating its first sample as a final score',async()=>{
 const f=scenario({denied:new Set([0])}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[1,2,3,4,5,6,7,8,9,10]);
 assert.equal(r.finalSelection.resumedDownloads,1);assert.equal(r.refinement.secondSamples,11);
 assert.equal(r.refinement.skippedByBound,13);assert.equal(r.refinement.savedSecondSamples,13);
 const tail=f.events.filter(e=>e.kind==='full'&&e.rank===10);assert.equal(tail.length,2);assert.equal(tail[1].stage,'补位第二次下载');
 assert.equal(r.finalSelection.replacements,1);assert.equal(r.supplement.refined,0);
});

test('failed resumed samples are never admitted or retried and lower bounds continue until a real top ten exists',async()=>{
 const f=scenario({denied:new Set([0]),invalidSecond:new Set([10])}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[1,2,3,4,5,6,7,8,9,11]);
 assert.equal(r.finalSelection.resumedDownloads,2);assert.equal(r.finalSelection.replacements,1);
 assert(!f.events.some(e=>e.rank===10&&e.stage==='出口与 Premium 最终复核'));
});
test('a deferred first-sample bound equal to the new cutoff still receives its second download',async()=>{
 const f=scenario({denied:new Set([0]),firstOverride:new Map([[11,600]])}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[1,2,3,4,5,6,7,8,9,10]);
 assert.equal(r.finalSelection.resumedDownloads,2);
 assert.equal(f.events.filter(e=>e.kind==='full'&&e.rank===11).length,2);
 assert.equal(f.events.filter(e=>e.kind==='full'&&e.rank===12).length,1);
});

test('expired-pair rejection removes that endpoint and validates its replacement without retrying the denial',async()=>{
 const f=scenario({oldPairs:true,denied:new Set([0])}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[1,2,3,4,5,6,7,8,9,10]);
 const issue=r.premiumFinalFailures.find(e=>e.reason==='region_unavailable');assert.equal(issue.phase,'refresh');assert(issue.discarded&&!issue.recoveryAttempted);
 const key=[...f.rank].find(([,r])=>r===0)[0];assert.equal(f.counts.get(key+'|premium'),3);
});

test('more failures than the initial 24 can cover use only the shared reserve budget and retain full qualification',async()=>{
 const f=scenario({denied:new Set(Array.from({length:18},(_,i)=>i))}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[18,19,20,21,22,23,24,25,26,27]);
 assert.equal(r.supplement.refined,4);assert.equal(r.supplement.added,4);
 assert.equal(r.premium.preflight.tested,24);assert.equal(r.premium.preflight.reserveTested,4);
 assert.equal(r.premium.preflight.notNeeded,132);
 assert.equal(new Set(f.events.filter(e=>e.kind==='premium').map(e=>e.key)).size,28);
 assert.equal(r.finalSelection.rejected,18);assert.equal(r.finalSelection.replacements,10);
 assert.equal(r.refinement.secondSamples,24);assert.equal(r.refinement.savedSecondSamples,0);
});

test('persistent final rejection stops at the existing 24 extra retests with no backend write',async()=>{
 const f=scenario({denied:new Set(Array.from({length:151},(_,i)=>i+9))});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/复核补位不足 10 个.*共享补选上限/);
 const state=f.progress.at(-1);assert.equal(state.supplement.refined,24);assert.equal(state.finalSelection.rejected,39);assert.equal(state.premium.verified,9);
 assert.equal(f.events.filter(e=>e.kind==='full').length,96);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
 assert.equal(new Set(state.premiumFinalFailures.map(e=>e.endpoint)).size,39);assert(state.premiumFinalFailures.every(e=>e.discarded));
 assert.equal(f.metrics().active,0);assert.equal(f.metrics().overlaps,0);
});

test('previously verified evidence that expires during filling is removed rather than reused beyond ten minutes',async()=>{
 const f=scenario({denied:new Set([0]),expireConfirmed:true}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
 assert.deepEqual(selectedRanks(r,f),[10,11,12,13,14,15,16,17,18,19]);
 assert.equal(r.finalSelection.expired,9);assert.equal(r.finalSelection.rejected,10);
 for(const [key,rank] of f.rank)if(rank>=1&&rank<=9)assert.equal(f.counts.get(key+'|premium'),3,'expired finalized nodes are not repeatedly refreshed');
});

test('cancel or network change before a resumed download aborts without another sample or publication',async()=>{
 for(const stop of ['cancel','network']){
  const f=scenario({denied:new Set([0]),stop});
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),/取消|网络变化/);
  assert(!f.events.some(e=>e.kind==='full'&&e.stage==='补位第二次下载'));assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
  assert.equal(f.metrics().active,0);assert.equal(f.metrics().overlaps,0);
 }
});

test('a backend edit after successful replacement is still preserved without publication',async()=>{
 const f=scenario({denied:new Set([0]),userChange:true});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/后台被改动/);
 assert.equal(f.posts.length,0);assert.equal(f.progress.at(-1).finalSelection.replacements,1);
});
test('an unexpected probe exception during final checking remains fatal and is never treated as a replaceable eligibility result',async()=>{
 const f=scenario(),probe=f.env.probe;
 f.env.probe=async spec=>{
  const r=await probe(spec),event=f.events.filter(e=>e.key===spec.descriptor).at(-1);
  if(event.kind==='premium'&&event.stage==='出口与 Premium 最终复核')throw new Error('synthetic adapter failure');
  return r;
 };
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/synthetic adapter failure/);
 assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);assert.equal(f.metrics().active,0);
});

test('deterministic subsets of failed candidates match an independent speed ranking with no unqualified fill',async()=>{
 for(let seed=1;seed<=8;seed++) {
  const denied=new Set(Array.from({length:24},(_,r)=>r).filter(r=>(r*17+seed*13)%7<2));
  const f=scenario({denied}),r=await C.execute(f.env,f.opts,pools);quality(r,f);
  const expected=Array.from({length:24},(_,i)=>i).filter(i=>!denied.has(i)).slice(0,10);
  assert.deepEqual(selectedRanks(r,f),expected);
 }
});
