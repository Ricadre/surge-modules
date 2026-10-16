const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs'),premiumPage=require('./premium-fixture.cjs');

function scenario(options={}) {
 const f=fixture(),probe=f.env.probe,progress=f.env.progress,sleep=f.env.sleep,now=f.env.now;
 const counts=new Map(),requests=[];let target=null,elapsed=0,stage='',stopped=false,active=0,peak=0;
 f.env.now=()=>now()+elapsed;
 f.env.cancelled=async()=>options.stop==='cancel'&&stopped;
 f.env.networkKey=()=>options.stop==='network'&&stopped?'changed':'original';
 f.env.progress=async p=>{
  stage=p.stage;
  if(options.oldPair&&stage==='出口与 Premium 最终复核'&&elapsed===0)elapsed=6*60*1000;
  await progress(p);
 };
 f.env.sleep=async ms=>{await sleep(ms);if(options.stop)stopped=true;};
 f.env.probe=async spec=>{
  active++;peak=Math.max(peak,active);
  try {
   const response=await probe(spec);
   if(!spec.url.startsWith('https://www.youtube.com/premium?'))return response;
   const ordinal=(counts.get(spec.descriptor)||0)+1;counts.set(spec.descriptor,ordinal);
   requests.push({descriptor:spec.descriptor,ordinal,stage});
   if(!target&&ordinal===3)target=spec.descriptor;
   if(spec.descriptor!==target)return response;
   if(options.expireAtThird&&ordinal===3)elapsed=11*60*1000;
   const change=options.reply&&options.reply(ordinal,response);
   return {...response,ms:100+ordinal,...change};
  } finally {active--;}
 };
 return {...f,counts,requests,target:()=>target,active:()=>active,peak:()=>peak};
}
const transport=kind=>({error:kind==='timeout'?'timeout':'connection reset with private details',status:0,data:''});
const failedState=f=>f.progress.at(-1);

test('one third-sample transport failure gets a fresh matching trio and retains its diagnostic history',async()=>{
 for(const kind of ['timeout','connection']) {
  const f=scenario({reply:n=>n===3?transport(kind):null}),r=await C.execute(f.env,f.opts,pools);
  assert(r.verified);assert.equal(f.posts.length,1);assert.equal(f.counts.get(f.target()),6);
  assert.equal(r.premium.recoveryAttempts,1);assert.equal(r.premium.recovered,1);assert.equal(r.premium.verified,10);
  const recovered=r.selected.find(e=>f.target().startsWith('CF-Probe-'+e.ip+'-'));
  assert.deepEqual(recovered.premium.samples.map(s=>s.durationMs),[104,105,106]);
  assert(r.selected.every(e=>P.qualified(e.premium,r.finishedAt)&&e.samples.length===2));
  assert.equal(r.premiumFinalFailures.length,1);
  const d=r.premiumFinalFailures[0];
  assert.equal(d.phase,'final');assert.equal(d.attempt,'initial');assert.equal(d.index,2);
  assert.equal(d.reason,kind==='timeout'?'network_timeout':'network');
  assert(d.recoveryAttempted&&d.recovered&&d.retryable);assert(d.candidate>=1&&d.candidate<=10);
  assert.match(d.endpoint,/^\d+\.\d+\.\d+\.\d+:\d+$/);
  assert(!JSON.stringify(d).includes('private details'));assert.equal(f.active(),0);
 }
});

test('a failed replacement trio stops at its first bad sample without another recovery or publication',async()=>{
 for(const failAt of [4,5,6]) {
  const f=scenario({reply:n=>n===3||n===failAt?transport('timeout'):null});
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),/候选 \d+ · Premium 发布前复核未通过：恢复三检失败，请求超时/);
  assert.equal(f.counts.get(f.target()),failAt);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
  const s=failedState(f);assert.equal(s.premium.recoveryAttempts,1);assert.equal(s.premium.recovered,0);
  assert.equal(s.premiumFinalFailures.length,2);
  assert.deepEqual(s.premiumFinalFailures.map(d=>d.attempt),['initial','recovery']);
  assert(s.premiumFinalFailures.every(d=>d.recoveryAttempted&&!d.recovered));assert.equal(f.active(),0);
 }
});

test('HTTP rejection and explicit Premium or country failures do not receive transport recovery',async()=>{
 const cases=[
  {reply:{status:403,data:''},reason:'http',text:/HTTP 请求未成功（403）/},
  {reply:{status:429,data:''},reason:'http',text:/HTTP 请求未成功（429）/},
  {reply:{status:503,data:''},reason:'http',text:/HTTP 请求未成功（503）/},
  {reply:{data:premiumPage({unavailable:true})},reason:'region_unavailable',text:/所在地区明确不支持/},
  {reply:{data:premiumPage({region:'JP'})},reason:'region_changed',text:/地区前后不一致/},
  {reply:{data:'before you continue to YouTube'},reason:'challenge',text:/验证或同意页面/},
  {reply:{data:'unrecognized page'},reason:'page_format',text:/无法识别页面结构/},
  {reply:{data:premiumPage({lite:true})},reason:'no_full_premium_offer',text:/未确认完整 Premium/}
 ];
 for(const c of cases) {
  const f=scenario({reply:n=>n===3?c.reply:null});
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),c.text);
  assert.equal(f.counts.get(f.target()),3);assert.equal(f.posts.length,0);
  const s=failedState(f),d=s.premiumFinalFailures[0];
  assert.equal(d.reason,c.reason);assert(!d.retryable&&!d.recoveryAttempted&&!d.recovered);
  assert.equal(s.premium.recoveryAttempts,0);assert.equal(f.active(),0);
 }
});

test('a replacement trio cannot erase a newly observed different country',async()=>{
 const f=scenario({reply:n=>n===3?transport('timeout'):n===4?{data:premiumPage({region:'JP'})}:null});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/恢复三检失败，地区前后不一致/);
 assert.equal(f.counts.get(f.target()),4);assert.equal(f.posts.length,0);
 assert.equal(failedState(f).premiumFinalFailures.at(-1).reason,'region_changed');
});

test('expired evidence is identified separately and cannot be recovered as a transient network failure',async()=>{
 const f=scenario({expireAtThird:true,reply:n=>n===3?transport('timeout'):null});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/检测记录已超过 10 分钟/);
 const s=failedState(f);assert(s.premiumFinalFailures.some(d=>d.reason==='expired'&&d.oldestAgeMs>=11*60*1000));
 assert.equal(s.premium.recoveryAttempts,0);assert.equal(f.posts.length,0);assert.equal(f.active(),0);
});

test('failed old-pair refresh keeps a specific phase and response code without recovery',async()=>{
 const f=scenario({oldPair:true,reply:n=>n===3?{status:503,data:''}:null});
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/候选 \d+ · Premium 更新检测未通过：HTTP 请求未成功（503）/);
 const d=failedState(f).premiumFinalFailures[0];
 assert.equal(d.phase,'refresh');assert.equal(d.reason,'http');assert.equal(d.httpStatus,503);
 assert(!d.recoveryAttempted);assert.equal(f.posts.length,0);assert.equal(f.active(),0);
});

test('cancellation or a network change during recovery backoff stops before a new request',async()=>{
 for(const stop of ['cancel','network']) {
  const f=scenario({stop,reply:n=>n===3?transport('timeout'):null});
  await assert.rejects(()=>C.execute(f.env,f.opts,pools),/取消|网络变化/);
  assert.equal(f.counts.get(f.target()),3);assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
  assert.equal(failedState(f).premium.recovered,0);assert.equal(f.active(),0);
 }
});

test('all in-flight final failures are drained and persisted rather than retaining only the first',async()=>{
 const f=scenario(),probe=f.env.probe;
 f.env.probe=async spec=>{
  const r=await probe(spec);
  if(spec.url.startsWith('https://www.youtube.com/premium?')&&f.counts.get(spec.descriptor)===3)
   return {...r,data:premiumPage({unavailable:true})};
  return r;
 };
 await assert.rejects(()=>C.execute(f.env,f.opts,pools),/所在地区明确不支持/);
 const failures=failedState(f).premiumFinalFailures;
 assert.equal(failures.length,4);assert.equal(new Set(failures.map(d=>d.candidate)).size,4);
 assert(failures.every(d=>d.reason==='region_unavailable'));assert.equal(f.posts.length,0);assert.equal(f.active(),0);
});
