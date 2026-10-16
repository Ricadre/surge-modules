const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../src/cf-autorank/pool-source.js'),C=require('../../src/cf-autorank/core.js');
const official=require('../../src/cf-autorank/official-pools.json'),legacy=require('../../src/cf-autorank/pools.json');
const now=2000000000000;
const response=(kind='text',ranges=official)=>({status:200,data:kind==='api'?JSON.stringify({success:true,result:{ipv4_cidrs:ranges}}):ranges.join('\n')});
function harness(replies,cached=null){const calls=[],saved=[];return {calls,saved,env:{now:()=>now,cached,guard:async()=>{},fetch:async url=>{calls.push(url);return replies[calls.length-1];},save:async c=>{saved.push(c);return true;}}};}
const cache=(age=0)=>({version:1,url:P.SOURCES[0].url,fetchedAt:now-age,ranges:official});
test('both official formats validate and cover more addresses than the original pool',()=>{
 assert.deepEqual(P.parse(response(),'text'),official);
 assert.deepEqual(P.parse(response('api'),'api'),official);
 const info=P.fallback(official,null,now);assert.equal(info.addressCount,1524736);assert.equal(info.rangeCount,15);
 assert(C.inPools('173.245.48.10',official)&&!C.inPools('173.245.48.10',legacy));
});
test('every refresh tries the live source even with a fresh cache',async()=>{
 const h=harness([response(),response()],cache());
 const a=await P.refresh(h.env,official),b=await P.refresh(h.env,official);
 assert.equal(h.calls.length,2);assert(h.calls.every(url=>url===P.SOURCES[0].url));
 assert.equal(h.saved.length,2);assert.equal(a.source,'live-text');assert.equal(b.source,'live-text');
});
test('changed official ranges replace the cache for the next candidate draw',async()=>{
 const changed=official.map(x=>x==='173.245.48.0/20'?'173.245.64.0/20':x);
 const h=harness([response('text',changed)],cache());const info=await P.refresh(h.env,official);
 assert.deepEqual(info.official,changed);assert.deepEqual(h.saved[0].ranges,changed);
});
test('failed or malformed primary falls back to the second official endpoint',async()=>{
 for(const bad of [{status:403,data:'blocked'},{status:200,data:'<html>challenge</html>'},{status:302,data:''},{error:'timeout',status:200,data:official.join('\n')}]) {
  const h=harness([bad,response('api')]);const info=await P.refresh(h.env,official);
  assert.equal(info.source,'live-api');assert.deepEqual(h.calls,P.SOURCES.map(x=>x.url));assert.equal(h.saved.length,1);
 }
});
test('offline uses only a valid recent cache, otherwise the bundled official snapshot',async()=>{
 for(const [cached,source] of [[cache(86400000),'cache'],[cache(P.MAX_AGE+1),'bundled'],[cache(-1),'bundled'],[{...cache(),url:'https://example.net/ips'},'bundled'],[{...cache(),ranges:['10.0.0.0/8']},'bundled'],[null,'bundled']]) {
  const h=harness([{status:503},{status:503}],cached),info=await P.refresh(h.env,official);
  assert.equal(info.source,source);assert.equal(h.saved.length,0);assert.equal(info.fetchedAt,source==='cache'?cached.fetchedAt:null);
 }
});
test('untrusted responses reject empty, truncated, oversized, overlapping, private and invalid CIDRs',()=>{
 for(const ranges of [[],official.slice(0,3),[...official,official[0]],official.map((x,i)=>i===0?'10.0.0.0/8':x),official.map((x,i)=>i===0?'192.0.0.0/8':x),official.map((x,i)=>i===0?'104.16.1.0/13':x),official.map((x,i)=>i===0?'0.0.0.0/0':x),official.map((x,i)=>i===0?'2001:db8::/32':x),Array(129).fill('1.1.1.0/24')])assert.throws(()=>P.validate(ranges));
 assert.throws(()=>P.parse({status:200,data:'x'.repeat(65537)},'text'));
 assert.throws(()=>P.parse({status:200,data:JSON.stringify({success:false,result:{ipv4_cidrs:official}})},'api'));
 assert.throws(()=>P.parse({status:200,data:'not json'},'api'));
});
test('cancellation or network change during source fetch stops before caching or sampling',async()=>{
 for(const reason of ['cancelled','network changed']) {
  const h=harness([response()]);let active=true;
  h.env.guard=()=>{if(!active)throw new Error(reason);};
  h.env.fetch=async()=>{active=false;return response();};
  await assert.rejects(()=>P.refresh(h.env,official),new RegExp(reason));assert.equal(h.saved.length,0);
 }
});
test('a cache write failure does not mislabel live data as cached',async()=>{
 const h=harness([response()]);h.env.save=async()=>false;
 const info=await P.refresh(h.env,official);assert.equal(info.source,'live-text');assert.equal(info.cacheSaved,false);
});
function random(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
test('expanded sampling retains current ten, draws 233 official and 77 legacy candidates, and varies by run',()=>{
 const current=Array.from({length:10},(_,i)=>C.endpoint('8.35.211.'+(i+1),2053,legacy));
 const a=C.candidates(current,legacy,320,random(42),official),b=C.candidates(current,legacy,320,random(5678),official);
 assert.equal(a.length,320);assert.equal(new Set(a.map(e=>e.ip)).size,320);assert(C.sameEntries(a.slice(0,10),current));
 assert.equal(a.filter(e=>e.candidateSource==='official').length,233);assert.equal(a.filter(e=>e.candidateSource==='legacy').length,77);
 assert(a.some(e=>!C.inPools(e.ip,legacy)));assert.notDeepEqual(a.slice(10),b.slice(10));
 for(const cidr of official)assert(a.some(e=>e.candidateSource==='official'&&C.inPools(e.ip,[cidr])));
 assert(a.every(e=>[443,2053,8443].includes(e.port)&&C.inPools(e.ip,legacy.concat(official))));
});
test('current out-of-pool endpoints are retained exactly without widening random sampling',()=>{
 const list='9.9.9.9:443#Current',allowed=C.includeCurrent(list,legacy.concat(official));
 assert(C.inPools('9.9.9.9',allowed));assert(!C.inPools('9.9.9.10',allowed));
 const current=C.parseList(list,allowed),all=C.candidates(current,legacy,320,random(42),official);
 assert.equal(all[0].key,'9.9.9.9:443');assert(all.slice(1).every(e=>C.inPools(e.ip,legacy.concat(official))));
 for(const ip of ['127.0.0.1','192.168.1.1','10.0.0.1','203.0.113.1'])assert.throws(()=>C.includeCurrent(ip+':443#Bad',legacy));
 assert.throws(()=>C.includeCurrent('9.9.9.9:80#Bad',legacy));
});
test('lite download sizes and default 320 count are unchanged',()=>{
 assert.deepEqual(C.MODES.lite,{screenBytes:131072,sampleBytes:2000000,finalists:24});
 const settings=C.settings('start|example.net');assert.equal(settings.mode,'lite');assert.equal(settings.limit,320);
});
