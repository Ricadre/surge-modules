const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs');

// Synthetic completed ranges model callback bodies; missing timed-out bodies
// must never be inferred from the requested range or the previous throughput.
async function window(replies,options={}) {
 let now=0,guards=0;const calls=[];
 const result=await C.chunkedDownload(async(size,timeout)=>{
  calls.push({size,timeout,started:now});const reply=replies[calls.length-1]||{};
  const ms=reply.ms===undefined?1000:reply.ms;now+=ms;
  return C.downloadValid({status:206,bytes:size,headers:{'Content-Range':`bytes 100-${99+size}/200000000`},ms,...reply},100,size);
 },8000000,8,2000000,()=>now,async()=>{
  if(options.abort&&++guards===options.abort)throw new Error('cancelled');
  if(options.delayBeforeSecond&&calls.length===1){now+=1000;options.delayBeforeSecond=false;}
 });
 return {result,calls,now};
}
test('full window combines four validated ranges within one byte and time budget',async()=>{
 const {result:r,calls}=await window([]);
 assert(r.valid&&!r.partial);assert.equal(r.bytes,8000000);assert.equal(r.ms,4000);assert.equal(r.mbps,16);
 assert.equal(r.chunks.complete,4);assert.equal(r.chunks.attempted,4);
 assert.deepEqual(calls.map(c=>c.timeout),[8,7,6,5]);assert(calls.every(c=>c.size===2000000));
});
test('a timeout without a body retains only earlier verified chunks and charges the entire timeout',async()=>{
 const {result:r,calls}=await window([{ms:3000},{error:'timeout',status:0,bytes:0,headers:{},ms:5000}]);
 assert(r.valid&&r.partial);assert.equal(r.bytes,2000000);assert.equal(r.ms,8000);assert.equal(r.mbps,2);
 assert.equal(r.lastStatus,0);assert.equal(r.chunks.emptyTimeouts,1);assert.equal(r.chunks.complete,1);
 assert.equal(r.termination,'timeout');assert.equal(calls.length,2);assert.equal(calls[1].timeout,5);
});
test('zero returned bytes on the first timeout never become a valid sample',async()=>{
 const {result:r,calls}=await window([{error:'timeout',status:0,bytes:0,headers:{},ms:8000}]);
 assert(!r.valid);assert.equal(r.reason,'timeout_empty');assert.equal(r.bytes,0);assert.equal(r.mbps,0);
 assert.equal(r.chunks.emptyTimeouts,1);assert.equal(calls.length,1);
});
test('partial timeout bytes require the matching HTTP 206 range and are counted exactly once',async()=>{
 const {result:r}=await window([{ms:3000},{error:'timeout',bytes:100000,ms:5000}]);
 assert(r.valid&&r.partial);assert.equal(r.bytes,2100000);assert.equal(r.mbps,2.1);assert.equal(r.chunks.partial,1);
 const bad=await window([{ms:3000},{error:'timeout',bytes:100000,status:0,headers:{},ms:5000}]);
 assert(!bad.result.valid);assert.equal(bad.result.reason,'http');
});
test('unexpected HTTP, invalid ranges and non-timeout failures invalidate the whole window without retries',async()=>{
 for(const reply of [
  {status:403,bytes:0},{status:200},{error:'request failed',bytes:0},
  {status:200,error:'timeout',bytes:0,headers:{}},{status:403,error:'timeout',bytes:0,headers:{}},
  {error:'timeout',bytes:0,headers:{'Content-Range':'bytes 1-2000000/200000000'}},
  {headers:{'Content-Range':'bytes 1-2000000/200000000'}},{bytes:100000},{bytes:2100000}
 ]){
  const {result:r,calls}=await window([{},reply]);assert(!r.valid);assert.equal(r.mbps,0);assert.equal(calls.length,2);
 }
});
test('the remaining timeout includes time spent between chunks and no request starts past the budget',async()=>{
 const {result:r,calls}=await window([{ms:3000},{ms:3500}],{delayBeforeSecond:true});
 assert.equal(calls.length,2);assert.equal(calls[1].timeout,4);assert.equal(r.ms,7500);
 assert(r.valid&&r.partial);assert.equal(r.termination,'deadline');assert.equal(r.bytes,4000000);
});
test('cancellation between chunks stops before issuing the next request',async()=>{
 await assert.rejects(()=>window([{}],{abort:3}),/cancelled/);
});
test('download errors receive safe reason codes instead of being labeled Premium failures',()=>{
 const base={status:206,bytes:2000000,ms:1000,headers:{'Content-Range':'bytes 100-2000099/200000000'}};
 for(const [patch,reason] of [
  [{error:'timeout',bytes:0,status:0,headers:{}},'timeout_empty'],
  [{error:'response size limit',bytes:0,status:0},'size_limit'],
  [{error:'request failed'},'network'],[{status:503},'http'],[{headers:{}},'range'],
  [{bytes:0},'empty_body'],[{bytes:100},'too_small'],[{bytes:100000},'truncated'],
  [{bytes:3000000},'oversize'],[{ms:0},'timing']
 ])assert.equal(C.downloadValid({...base,...patch},100,2000000).reason,reason);
});
test('full mode publishes only two valid aggregate windows per winner, with the same caps and strict Premium',async()=>{
 const f=fixture(),probe=f.env.probe;f.opts.mode='full';
 const trace=[],active=new Set();let overlaps=0,clock=1000000;
 f.env.now=()=>clock;
 f.env.probe=async spec=>{
  const range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);
  const size=range?Number(range[2])-Number(range[1])+1:0;
  if(size>524288){if(active.size)overlaps++;active.add(spec.descriptor);trace.push({descriptor:spec.descriptor,size,timeout:spec.timeout});}
  try {const r=await probe(spec);clock+=10;
   // Each 2 MB chunk is valid. A slower third chunk times out with no body.
   if(size>524288){const n=trace.filter(x=>x.descriptor===spec.descriptor).length;
    if(n%3===0){clock+=3990;return {status:0,error:'timeout',bytes:0,ms:4000,headers:{}};}
    clock+=1990;return {...r,ms:2000};
   }
   return r;
  } finally{active.delete(spec.descriptor);}
 };
 const r=await C.execute(f.env,f.opts,pools);
 assert(r.verified);assert.equal(f.posts.length,1);assert.equal(r.selected.length,10);assert.equal(r.candidateCount,2560);
 assert.equal(overlaps,0);assert.equal(active.size,0);
 assert(trace.every(e=>e.size===2000000&&e.timeout<=8));
 assert(r.selected.every(e=>e.samples.length===2&&e.samples.every(s=>s.valid&&s.partial&&s.bytes===4000000&&s.ms===8000&&s.mbps===4)));
 assert(r.selected.every(e=>P.qualified(e.premium,f.env.now())));
 assert(r.downloadDiagnostics.retest.emptyTimeouts>0);assert.equal(r.downloadDiagnostics.retest.valid,r.downloadDiagnostics.retest.samples);
 assert.equal(r.stability.failed,0);assert.equal(r.premium.verified,10);
});
test('unusable download callbacks remain distinct from passing Premium checks and never change the backend',async()=>{
 const f=fixture(),probe=f.env.probe;f.opts.mode='full';
 f.env.probe=async spec=>{
  if(spec.headers.Range){const [a,b]=spec.headers.Range.slice(6).split('-').map(Number);
   if(b-a+1>524288)return {status:0,bytes:0,ms:8000,error:'timeout',headers:{}};
  }
  return probe(spec);
 };
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/综合检查合格 0\/10/);
 const s=f.progress.at(-1);assert(s.premium.eligible>=10);assert(s.stability.passed>=10);
 assert.equal(s.downloadDiagnostics.retest.valid,0);assert.equal(s.downloadDiagnostics.retest.failures.timeout_empty,s.downloadDiagnostics.retest.samples);
 assert.equal(s.downloadDiagnostics.retest.http[0],s.downloadDiagnostics.retest.samples);
 assert.equal(s.downloadDiagnostics.examples.filter(e=>e.phase==='retest').length,3);
 assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
});

test('a later full-mode chunk ignoring Range aborts publication even when that response also times out',async()=>{
 const f=fixture(),probe=f.env.probe;f.opts.mode='full';let fullCalls=0;
 f.env.probe=async spec=>{
  if(spec.headers.Range){const [a,b]=spec.headers.Range.slice(6).split('-').map(Number);
   if(b-a+1>524288&&++fullCalls===2)return {status:200,bytes:0,ms:8000,error:'timeout',headers:{}};
  }
  return probe(spec);
 };
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/下载源未遵守 Range/);
 assert.equal(fullCalls,2);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
 assert.equal(f.progress.at(-1).downloadDiagnostics.retest.failures.http,1);
});
