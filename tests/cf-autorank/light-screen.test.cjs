const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js');
function random(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function entry(n,ms=n+1){const ip=C.numberIP(C.ipNumber('104.16.0.0')+n+1);return {ip,port:443,key:ip+':443',lightSamples:[{status:204,ms},{status:204,ms:ms+10}]};}
test('lite and full keep independent fixed light-screen coverage',()=>{
 for(const limit of [40,80,160,320,1024]) {
  for(const [mode,total] of [['lite',1280],['full',2560]]) {
   const opts=C.settings('start|example.net|'+mode+'|'+limit+'|');
   assert.equal(opts.limit,limit);assert.equal(C.scanCount(opts.mode),total);
  }
 }
 assert.equal(C.LIGHT_SCREEN.lite.concurrency,8);assert.equal(C.LIGHT_SCREEN.full.concurrency,8);
});
test('only successful finite HTTP 204 measurements count as light-probe results',()=>{
 assert(C.lightValid({status:204,ms:1}));
 for(const r of [null,{status:200,ms:1},{status:301,ms:1},{status:204,ms:0},{status:204,ms:NaN},{status:204,ms:Infinity},{status:204,ms:'100'},{status:204,ms:1,error:'timeout'}])assert(!C.lightValid(r));
});
test('download shortlist keeps passing current nodes, mostly low latency and a sample of others',()=>{
 const rows=Array.from({length:1280},(_,i)=>entry(i)),current=rows.slice(-10);
 const selected=C.pickDownloads(rows,current,160,random(42));
 assert.equal(selected.length,160);assert.equal(new Set(selected.map(e=>e.ip)).size,160);
 assert.deepEqual(selected.filter(e=>e.downloadReason==='current').map(e=>e.key),current.map(e=>e.key));
 assert.deepEqual(selected.filter(e=>e.downloadReason==='latency').map(e=>e.key),rows.slice(0,120).map(e=>e.key));
 const exploration=selected.filter(e=>e.downloadReason==='exploration');assert.equal(exploration.length,30);
 assert(exploration.some(e=>e.lightLatency>1000));
 assert.notDeepEqual(exploration,C.pickDownloads(rows,current,160,random(567)).filter(e=>e.downloadReason==='exploration'));
});
test('shortlist uses the slower of two observations, rejects flaky entries and deduplicates IPs',()=>{
 const jitter=entry(0,1);jitter.lightSamples[1].ms=1000;
 const steady=entry(1,100),flaky=entry(2),once=entry(3),duplicate={...steady,port:2053,key:steady.ip+':2053'};
 flaky.lightSamples[1].error='timeout';once.lightSamples.pop();
 const selected=C.pickDownloads([jitter,flaky,once,steady,duplicate],[],320,random(42));
 assert.equal(selected.length,2);assert.equal(selected[0].ip,steady.ip);assert.equal(selected[1].lightLatency,1000);
 assert.equal(new Set(selected.map(e=>e.ip)).size,2);
});
test('fewer passing entries proceed without padding and failed current entries have no reserved slot',()=>{
 const rows=Array.from({length:23},(_,i)=>entry(i));rows[0].lightSamples[1].status=503;
 const selected=C.pickDownloads(rows,[rows[0]],320,random(42));
 assert.equal(selected.length,22);assert(!selected.some(e=>e.key===rows[0].key));
});
test('adaptive screening rechecks a degraded batch at eight before admitting its rows',async()=>{
 const entries=Array.from({length:320},(_,i)=>entry(i)),calls=new Map(),reports=[];
 let active=0,peak=0;
 const r=await C.adaptiveLightScreen(entries,C.LIGHT_SCREEN.lite,async e=>{
  const n=(calls.get(e.key)||0)+1;calls.set(e.key,n);
  // Use actual active workers below rather than wall-clock timers.
  active++;peak=Math.max(peak,active);const overloaded=active>8;
  await new Promise(resolve=>setImmediate(resolve));active--;
  return overloaded?[{status:0,error:'timeout',ms:4000}]:[{status:204,ms:100},{status:204,ms:100}];
 },async p=>{reports.push({...p,stats:undefined});});
 assert(r.stats.backoffs>0);assert(r.stats.rechecked>0);assert.equal(r.rows.length,entries.length);
 assert(r.rows.every(e=>e.lightSamples.every(C.lightValid)));
 assert(peak<=16);assert(reports.some(p=>p.rechecking&&p.concurrency===8));
 assert([...calls.values()].some(n=>n===2));assert.equal(new Set(r.rows.map(e=>e.key)).size,entries.length);
});
