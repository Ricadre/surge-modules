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
const diagnosticNow=1000000;
const diagnosticSample=patch=>({status:'available',reason:'full_premium_offer',region:'US',checkedAt:diagnosticNow,
 httpStatus:200,networkError:null,durationMs:250,...patch});
const diagnosticValue=(samples,patch)=>({status:'available',region:'US',samples,...patch});
const transportSample=kind=>diagnosticSample({status:'unknown',reason:'network',region:null,httpStatus:0,networkError:kind});
test('qualification diagnostics keep the exact three-check, same-region and ten-minute standard',()=>{
 const samples=[diagnosticSample({checkedAt:diagnosticNow-P.MAX_AGE}),diagnosticSample(),diagnosticSample()];
 assert.equal(P.failure(diagnosticValue(samples),diagnosticNow),null);
 assert(P.qualified(diagnosticValue(samples),diagnosticNow));
 for(const length of [0,1,2,4]) {
  const value=diagnosticValue(Array.from({length},()=>diagnosticSample()));
  assert.equal(P.failure(value,diagnosticNow).reason,'incomplete');assert(!P.qualified(value,diagnosticNow));
 }
 assert.equal(P.failure(null,diagnosticNow).reason,'incomplete');
 assert.equal(P.failure(diagnosticValue([null,diagnosticSample(),diagnosticSample()]),diagnosticNow).reason,'incomplete');
});
test('diagnostics distinguish each known terminal reason without reporting raw response content',()=>{
 const cases=[
  ['network_timeout',transportSample('timeout')],['network',transportSample('connection')],
  ['http',diagnosticSample({status:'unknown',reason:'http',region:null,httpStatus:503})],
  ['region_unavailable',diagnosticSample({status:'unavailable',reason:'region_unavailable',region:null})],
  ...['challenge','body','page_format','region_unknown','no_full_premium_offer'].map(reason=>[reason,diagnosticSample({status:'unknown',reason,region:null})]),
  ['region_changed',diagnosticSample({region:'JP'})],
  ['expired',diagnosticSample({checkedAt:diagnosticNow-P.MAX_AGE-1})],
  ['future_time',diagnosticSample({checkedAt:diagnosticNow+1})],
  ['invalid_time',diagnosticSample({checkedAt:NaN})]
 ];
 for(const [reason,sample] of cases) {
  const d=P.failure(diagnosticValue([diagnosticSample(),diagnosticSample(),sample]),diagnosticNow);
  assert.equal(d.reason,reason);assert.equal(d.index,2);
  assert.equal(d.retryable,['network_timeout','network'].includes(reason));
  assert.deepEqual(Object.keys(d),['reason','index','httpStatus','networkError','regions','oldestAgeMs','retryable']);
 }
 const unknown=diagnosticSample({status:'unknown',reason:'untrusted synthetic content',region:'not-a-country',httpStatus:'https://example.invalid/private',networkError:'sensitive-value'});
 const d=P.failure(diagnosticValue([diagnosticSample(),diagnosticSample(),unknown]),diagnosticNow);
 assert.equal(d.reason,'incomplete');assert.equal(d.httpStatus,0);assert.equal(d.networkError,null);assert.equal(d.regions[2],null);
 assert(!JSON.stringify(d).includes('untrusted'));assert(!JSON.stringify(d).includes('sensitive'));assert(!JSON.stringify(d).includes('private'));
});
test('freshness, a changed region and permanent failures take precedence over a simultaneous transport failure',()=>{
 const cases=[
  ['expired',diagnosticSample({checkedAt:diagnosticNow-P.MAX_AGE-1})],
  ['future_time',diagnosticSample({checkedAt:diagnosticNow+1})],
  ['invalid_time',diagnosticSample({checkedAt:Infinity})],
  ['region_changed',diagnosticSample({region:'JP'})],
  ['region_unavailable',diagnosticSample({status:'unavailable',reason:'region_unavailable',region:null})],
  ['challenge',diagnosticSample({status:'unknown',reason:'challenge',region:null})],
  ['http',diagnosticSample({status:'unknown',reason:'http',region:null,httpStatus:429})]
 ];
 for(const [reason,first] of cases) {
  const d=P.failure(diagnosticValue([first,diagnosticSample(),transportSample('timeout')]),diagnosticNow);
  assert.equal(d.reason,reason);assert.equal(d.index,0);assert.equal(d.retryable,false);
 }
});
test('failed refresh pairs report their actual failure before the incomplete sample count',()=>{
 for(const samples of [
  [transportSample('timeout')],
  [diagnosticSample(),transportSample('connection')],
  [diagnosticSample(),diagnosticSample({region:'JP'})],
  [diagnosticSample({status:'unavailable',reason:'region_unavailable',region:null})]
 ]) {
  const d=P.failure(diagnosticValue(samples,{status:'unknown',region:null}),diagnosticNow);
  assert.notEqual(d.reason,'incomplete');assert.equal(d.retryable,false);
 }
 assert.equal(P.failure(diagnosticValue([diagnosticSample()],{region:'JP'}),diagnosticNow).reason,'region_changed');
 assert.equal(P.failure(diagnosticValue([diagnosticSample(),diagnosticSample()]),diagnosticNow).reason,'incomplete');
});
test('only an explicit third transport failure with two matching fresh full-Premium checks is retryable',()=>{
 for(const kind of ['timeout','connection']) {
  const good=diagnosticValue([diagnosticSample(),diagnosticSample(),transportSample(kind)]);
  assert(P.failure(good,diagnosticNow).retryable);
  for(const change of [
   {status:'unknown'}, {region:null}, {region:'JP'},
   {samples:[diagnosticSample(),transportSample(kind),diagnosticSample()]},
   {samples:[diagnosticSample(),diagnosticSample(),{...transportSample(kind),networkError:null}]},
   {samples:[diagnosticSample(),diagnosticSample(),{...transportSample(kind),checkedAt:NaN}]},
   {samples:[diagnosticSample(),diagnosticSample(),{...transportSample(kind),httpStatus:503}]},
   {samples:[diagnosticSample(),diagnosticSample(),{...transportSample(kind),region:'JP'}]}
  ])assert.equal(P.failure({...good,...change},diagnosticNow).retryable,false);
 }
 for(const status of [301,302,403,408,429,500,502,503,504]) {
  const d=P.failure(diagnosticValue([diagnosticSample(),diagnosticSample(),diagnosticSample({status:'unknown',reason:'http',region:null,httpStatus:status})]),diagnosticNow);
  assert.equal(d.reason,'http');assert.equal(d.httpStatus,status);assert.equal(d.retryable,false);
 }
});
test('probe diagnostics retain only safe status, transport and timing values',async()=>{
 const rawSecret='synthetic-secret-that-must-not-be-logged';
 for(const [error,expected] of [[null,null],['timeout '+rawSecret,'timeout'],['request failed '+rawSecret,'connection']]) {
  const env={now:()=>diagnosticNow,id:()=>rawSecret,probe:async()=>response(page()+'<!-- '+rawSecret+' -->',{error,ms:321})};
  const result=await P.probe(env,'private-descriptor-'+rawSecret,async()=>{});
  assert.equal(result.httpStatus,200);assert.equal(result.networkError,expected);assert.equal(result.durationMs,321);
  assert.deepEqual(Object.keys(result),['status','reason','region','checkedAt','bytes','httpStatus','networkError','durationMs']);
  assert(!JSON.stringify(result).includes(rawSecret));assert(!JSON.stringify(result).includes('<html>'));
 }
 for(const invalid of [undefined,null,'200',NaN,Infinity,-1,0,99,600,200.5]) {
  const env={now:()=>diagnosticNow,id:()=>'',probe:async()=>response(page(),{status:invalid,ms:invalid})};
  const result=await P.probe(env,'test-descriptor',async()=>{});
  assert.equal(result.httpStatus,0);assert(Number.isFinite(result.durationMs)&&result.durationMs>0);
 }
});
