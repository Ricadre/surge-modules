const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../../src/cf-autorank/youtube-premium.js');
const page=require('./premium-fixture.cjs');
const response=(data=page(),extra={})=>({status:200,data,...extra});
test('Premium requires a priced, active full-Premium offer, not Lite or marketing',()=>{
 assert.deepEqual(P.classify(response()),{status:'available',reason:'full_premium_offer',region:'US'});
 for(const data of [page({lite:true}),page({disabled:true}),'<html>YouTube Premium ad-free Get Premium</html>',
  page().replace('$10 / month','No offer'),page().replace('SPunlimited','FEwhat_to_watch'),
  page().replace('synthetic-offer',''),page().replace('"/premium"','"/premiumlite"')]) {
  assert.notEqual(P.classify(response(data)).status,'available');
 }
});
test('unavailable, challenge, timeout, redirect and unexpected pages never pass',()=>{
 assert.equal(P.classify(response(page({unavailable:true}))).status,'unavailable');
 for(const r of [response(page(),{error:'timeout'}),response(page(),{status:302}),response(page(),{status:429}),
  response(page(),{status:403}),response(page(),{status:204}),response('Before you continue to YouTube'+page()),
  response('Our systems have detected unusual traffic'+page()),response(''),response({}),response('x'.repeat(P.MAX_HTML+1)),
  response(page().replace('var ytInitialData = ','var otherData = ')),response(page().replace(/<\/script><\/html>$/,'' ).slice(0,-20))]) {
  assert.equal(P.classify(r).status,'unknown');
 }
});
test('missing, conflicting and placeholder regions are unknown, never default to US',()=>{
 for(const data of [page({region:''}),page({region:'XX'}),page().replace('INNERTUBE_CONTEXT_GL','other'),
  page()+'<script>{"INNERTUBE_CONTEXT_GL":"JP"}</script>'])assert.equal(P.classify(response(data)).status,'unknown');
 assert.equal(P.classify(response(page({region:'JP'}))).region,'JP');
});
test('JSON data extraction handles braces in strings without executing page code',()=>{
 const data={contents:{text:'brace } and quote " and slash \\', nested:{value:'ok'}}};
 for(const marker of ['var ytInitialData = ','ytInitialData=','window["ytInitialData"] = ']) {
  assert.deepEqual(P.initialData(marker+JSON.stringify(data)+';throw Error("must not execute");'),data);
 }
 assert.equal(P.initialData('var ytInitialData = {"contents": evil()};'),null);
});
test('qualification needs three current available samples in the same region',()=>{
 const now=1000000,sample={status:'available',reason:'full_premium_offer',region:'JP',checkedAt:now};
 const value={status:'available',region:'JP',samples:[sample,sample,sample]};
 assert(P.qualified(value,now));
 assert(!P.qualified({...value,samples:[sample,sample]},now));
 for(const change of [{status:'unknown'},{region:'US'},{reason:'generic_marketing'},{checkedAt:now+1},{checkedAt:now-P.MAX_AGE-1}]) {
  assert(!P.qualified({...value,samples:[sample,sample,{...sample,...change}]},now));
 }
});
test('probe uses the explicit node without a forced country or any credentials in the URL',async()=>{
 let count=0,guards=0;const specs=[];
 const env={now:()=>123,id:()=>String(++count),probe:async spec=>{specs.push(spec);return response(page({region:'JP'}));}};
 for(let i=0;i<2;i++)assert.equal((await P.probe(env,'test-descriptor',async()=>{guards++;})).status,'available');
 assert.equal(guards,4);assert.equal(new Set(specs.map(s=>s.url)).size,2);
 for(const spec of specs){const u=new URL(spec.url);assert.equal(u.hostname,'www.youtube.com');assert.equal(u.pathname,'/premium');assert(!u.searchParams.has('gl'));assert.equal(spec.descriptor,'test-descriptor');assert(!spec.policy);assert(!spec.headers.Cookie);assert.equal(spec.method,'GET');}
 assert.equal(P.utf8Bytes('A中文🇯🇵'),Buffer.byteLength('A中文🇯🇵'));
});
