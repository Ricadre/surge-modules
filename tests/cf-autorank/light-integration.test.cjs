const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../../src/cf-autorank/core.js'),P=require('../../src/cf-autorank/youtube-premium.js');
const {fixture,pools}=require('./core-fixture.cjs');
function clock(){
 let now=1000000,queue=[],scheduled=false;
 function pump(){if(scheduled)return;scheduled=true;setImmediate(()=>{
  scheduled=false;if(!queue.length)return;now=Math.min(...queue.map(x=>x.at));
  const ready=queue.filter(x=>x.at===now);queue=queue.filter(x=>x.at!==now);ready.forEach(x=>x.resolve());if(queue.length)pump();
 });}
 return {now:()=>now,wait:ms=>new Promise(resolve=>{queue.push({at:now+ms,resolve});pump();})};
}
function frozen(){
 const source=fs.readFileSync(path.join(__dirname,'../../scripts/CF-AutoRank-0.1.18.js'),'utf8'),context=vm.createContext({});
 vm.runInContext(source.slice(0,source.lastIndexOf('(async function () {')),context);return context.CFRankCore;
}
function simulate(options={}){
 const f=fixture(),time=clock(),original=f.env.probe,saveProgress=f.env.progress,indices=new Map(),counts=new Map(),events=[],inflight=new Set();
 let active=0,fullActive=0,overlaps=0,peak=0,stopped=false;
 f.opts.limit=160;f.env.now=time.now;f.env.sleep=time.wait;
 f.env.cancelled=async()=>options.stop==='cancel'&&stopped;
 f.env.networkKey=()=>options.stop==='network'&&stopped?'new-network':'original-network';
 f.env.progress=async value=>{await saveProgress(value);};
 function index(ip){if(!indices.has(ip))indices.set(ip,indices.size);return indices.get(ip);}
 const lightMs=(i,pass)=>options.equalLight?100:80+(i*37%1280)+(pass===2?i*11%97:0);
 const fullMs=(i,pass)=>pass===1?400+i*8:450+i*9;
 f.env.probe=async spec=>{
  const ip=/CF-Probe-(\d+\.\d+\.\d+\.\d+)-/.exec(spec.descriptor)[1],i=index(ip);
  const range=spec.headers.Range&&/bytes=(\d+)-(\d+)/.exec(spec.headers.Range),size=range?Number(range[2])-Number(range[1])+1:0;
  const kind=spec.url.includes('cf_rank_light=')?'light':size>131072?'full':size?'screen':spec.url.includes('/premium?')?'premium':spec.url.includes('ipify')?'exit':'stable';
  const key=ip+'|'+kind,ordinal=(counts.get(key)||0)+1;counts.set(key,ordinal);
  // The new flow labels request rounds explicitly; the frozen eager flow uses
  // per-IP ordinals. These scenarios have no artificial congestion replays.
  const pass=kind==='light'?Number((/-p([12])-/.exec(new URL(spec.url).searchParams.get('cf_rank_light')||'')||[])[1])||ordinal:ordinal;
  let ms=kind==='light'?lightMs(i,pass):kind==='full'?fullMs(i,ordinal):kind==='screen'?250+i*7:kind==='premium'?120:25+i%31;
  const failed=kind==='light'&&options.failures&&((pass===1&&i%13===0)||(pass===2&&i%11===0));
  if(failed)ms=4000;
  assert(!inflight.has(ip),'requests for one IP must be sequential');inflight.add(ip);
  if(kind==='full'&&active||kind!=='full'&&fullActive)overlaps++;
  active++;if(kind==='full')fullActive++;peak=Math.max(peak,active);
  const event={ip,i,kind,ordinal,pass,ms,startedAt:time.now(),failed};events.push(event);
  try{
   await time.wait(ms);const response={...await original(spec),ms};
   if(options.stop&&kind==='light'&&pass===2)stopped=true;
   return failed?{status:0,error:'timeout',ms,bytes:0}:response;
  }finally{event.finishedAt=time.now();active--;if(kind==='full')fullActive--;inflight.delete(ip);}
 };
 return {...f,events,indices,time,fullMs,counts,metrics:()=>({active,overlaps,peak,fullActive})};
}
function assertCurrentQuality(r,f){
 assert(r.verified);assert.equal(r.candidateCount,1280);assert.equal(r.downloadCandidateCount,160);
 assert.equal(new Set(f.events.filter(e=>e.kind==='light'&&e.pass===1).map(e=>e.ip)).size,1280);
 const screen=f.events.filter(e=>e.kind==='screen');assert.equal(screen.length,160);
 for(const e of screen){
  const evidence=f.events.filter(x=>x.ip===e.ip&&x.kind==='light');
  assert(evidence.some(x=>x.pass===1&&!x.failed));assert(evidence.some(x=>x.pass===2&&!x.failed));
 }
 // Independent end-to-end oracle for this all-Premium-available fixture:
 // small-download ranking chooses 24; each winner is scored by its slower
 // full download. No current-node bypass or single-sample score is accepted.
 const mbps=ms=>Number((16000/ms).toFixed(3));
 const smallScore=ms=>Number((1048.576/ms).toFixed(3));
 const finalists=screen.slice().sort((a,b)=>smallScore(b.ms)-smallScore(a.ms)||a.finishedAt-b.finishedAt||f.events.indexOf(a)-f.events.indexOf(b)).slice(0,24);
 const expected=finalists.map(e=>({...e,score:Math.min(mbps(f.fullMs(e.i,1)),mbps(f.fullMs(e.i,2)))}))
  .sort((a,b)=>b.score-a.score||a.i%31-b.i%31).slice(0,10);
 assert.deepEqual(r.selected.map(e=>e.ip),expected.map(e=>e.ip));
 assert.deepEqual(r.selected.map(e=>e.score),expected.map(e=>e.score));
 for(const e of r.selected){assert.equal(e.samples.length,2);assert(e.samples.every(s=>s.valid));assert(P.qualified(e.premium,r.finishedAt));}
 const m=f.metrics();assert.equal(m.active,0);assert.equal(m.fullActive,0);assert.equal(m.overlaps,0);assert(m.peak<=16);
 assert.equal(f.posts.length,1);assert(r.lightRequests===f.events.filter(e=>e.kind==='light').length);
}
test('selective light screening preserves coverage and complete downstream quality while reducing simulated light work',async t=>{
 const old=simulate(),next=simulate();
 const a=await frozen().execute(old.env,old.opts,pools),b=await C.execute(next.env,next.opts,pools);
 assertCurrentQuality(b,next);
 assert.equal(old.indices.size,next.indices.size);assert.deepEqual([...old.indices.keys()],[...next.indices.keys()]);
 assert(b.lightRequests<a.lightRequests);
 const lightDuration=f=>{const e=f.events.filter(x=>x.kind==='light');return Math.max(...e.map(x=>x.finishedAt))-Math.min(...e.map(x=>x.startedAt));};
 assert(lightDuration(next)<lightDuration(old));
 t.diagnostic(JSON.stringify({synthetic:true,baseline:'0.1.18',oldLightSeconds:lightDuration(old)/1000,newLightSeconds:lightDuration(next)/1000,oldLightRequests:a.lightRequests,newLightRequests:b.lightRequests,firstCoverage:1280,downloads:160}));
});
test('first- and second-round failures cannot enter the 160 download candidates or weaken Premium publication',async()=>{
 const f=simulate({failures:true}),r=await C.execute(f.env,f.opts,pools);assertCurrentQuality(r,f);
 assert(f.events.some(e=>e.kind==='light'&&e.pass===1&&e.failed));assert(f.events.some(e=>e.kind==='light'&&e.pass===2&&e.failed));
});
test('cancellation and network changes during selective second checks drain all requests and never publish',async()=>{
 for(const stop of ['cancel','network']){
  const f=simulate({stop});await assert.rejects(()=>C.execute(f.env,f.opts,pools),/取消|网络变化/);
  assert.equal(f.metrics().active,0);assert(f.events.every(e=>Number.isFinite(e.finishedAt)));
  assert.equal(f.posts.length,0);assert.equal(f.getList(),f.original);
  assert(!f.events.some(e=>e.kind==='screen'));
 }
});

test('equal light bounds do not incur a large scheduling penalty when all second checks remain necessary',async t=>{
 const old=simulate({equalLight:true}),next=simulate({equalLight:true});
 const a=await frozen().execute(old.env,old.opts,pools),b=await C.execute(next.env,next.opts,pools);
 assertCurrentQuality(b,next);assert.equal(a.lightRequests,2560);assert.equal(b.lightRequests,2560);
 const duration=f=>{const events=f.events.filter(e=>e.kind==='light');return Math.max(...events.map(e=>e.finishedAt))-Math.min(...events.map(e=>e.startedAt));};
 t.diagnostic(JSON.stringify({synthetic:true,scenario:'equal-light',oldLightSeconds:duration(old)/1000,newLightSeconds:duration(next)/1000}));
 assert(duration(next)<=duration(old)*1.05,'retain established safe concurrency when there is no second-pass pruning');
});
