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
