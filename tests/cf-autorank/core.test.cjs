const convertedName=require('./subconverter-fixture.cjs');
const test=require('node:test');const assert=require('node:assert/strict');const C=require('../../src/cf-autorank/core.js');const pools=require('../../src/cf-autorank/pools.json');
const HOST='example.net',PASS='11111111-1111-4111-8111-111111111111';
function config(){return {HOST,HOSTS:[HOST],UUID:PASS,PATH:'/',协议类型:'trojan',传输协议:'ws',跳过证书验证:false,随机路径:false,启用0RTT:false,ECH:false,优选订阅生成:{local:true,本地IP库:{随机IP:false},TOKEN:'f'.repeat(32)}};}
function fixture(options={}) {
 let list=Array.from({length:options.count||10},(_,i)=>`8.35.211.${i+1}:2053#${options.alreadyNamed?`【🇺🇸】 CF${i+1}-8.35.211.${i+1}`:`CF-YouTube-${String(i+1).padStart(2,'0')}`}`).join('\n');
 const original=list,posts=[],calls=[],progress=[],geoCalls=[];let probes=0,time=1000000,snapshots=0,seed=42,id=0;
 const cfg=config();
 const env={
  now:()=>time,id:()=>String(++id),random:()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;},
  networkKey:()=>options.networkChange&&probes>8?'new':'old',
  geoip:ip=>{geoCalls.push(ip);return options.geoipUnknown?'':'US';},
  cancelled:async()=>options.cancel&&probes>8,
  sleep:async ms=>{time+=ms;},
  progress:async p=>progress.push({...p}),backup:async b=>{assert.equal(b.list,original);},
  login:async()=>{if(options.loginFail)throw new Error('登录失败');},
  control:async(method,path,body)=>{
   calls.push([method,path]);
   if(method==='POST'){assert.equal(path,'/admin/ADD.txt');assert.equal(C.parseList(body,pools).length,10);posts.push(body);list=body;return {success:true};}
   if(path==='/admin/config.json'){snapshots++;if(options.userChange&&snapshots===2)list=original.replace('8.35.211.1:','8.35.211.250:');if(options.wrongMode)cfg.优选订阅生成.local=false;return structuredClone(cfg);}
   if(path==='/admin/ADD.txt')return list;
   const entries=C.parseList(list,pools);
   if(path.endsWith('&b64'))return Buffer.from(entries.map(e=>`trojan://${PASS}@${e.key}?security=tls&type=ws&host=${HOST}&sni=${HOST}&path=%2F#${encodeURIComponent(options.rawNameFail&&posts.length===1?'Old name':e.name)}`).join('\n')).toString('base64');
   if(path.endsWith('&surge'))return '[Proxy]\n'+entries.map((e,i)=>`${options.surgeNameFail&&posts.length===1?'Old name':convertedName(e.name)} = trojan, ${options.verifyFail&&posts.length===1?'8.35.211.253':e.ip}, ${e.port}, password=${PASS}, sni=${HOST}, ws=true, ws-path=/, ws-headers=Host:${HOST}, skip-cert-verify=false`).join('\n');
   throw new Error('Unknown path');
  },
  probe:async spec=>{
   probes++;time+=10;
   if(options.expired&&probes>8)time+=3600000;
   assert.match(spec.descriptor,/^CF-Probe-.* = trojan, /);assert.match(spec.descriptor,/skip-cert-verify=false/);
   if(options.allFail)return {error:'timeout',status:0,bytes:0,ms:4000,headers:{}};
   if(spec.url.startsWith('https://api.ipify.org?')){assert.equal(spec.headers.Range,undefined);return {status:200,data:JSON.stringify({ip:'8.8.4.4'}),ms:100,error:null};}
   if(spec.headers.Range){const m=/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);const size=Number(m[2])-Number(m[1])+1;
    if(options.ignoredRange)return {status:200,bytes:size,ms:100,headers:{}};
    return {status:206,bytes:size,ms:100+(probes%13)*10,headers:{'Content-Range':`bytes ${m[1]}-${m[2]}/200000000`}};
   }
   return {status:204,ms:250,error:null,headers:{}};
  }
 };
 return {env,opts:{host:HOST,password:'local-only',limit:40,mode:'lite'},posts,calls,original,progress,geoCalls,getList:()=>list};
}
test('settings preserves separators in password and validates host',()=>{
 assert.equal(C.settings('start|example.net|lite|320|a|b&c').password,'a|b&c');
 assert.equal(C.settings('start|example.net|lite|320|b64:'+Buffer.from('汉字"x').toString('base64')).password,'汉字"x');
 assert.throws(()=>C.settings('start|example.net/path|lite|320|x'));
});
test('candidate pool includes current endpoints and three TLS ports',()=>{
 const f=fixture();let seed=7;const rng=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const current=C.parseList(f.original,pools),all=C.candidates(current,pools,320,rng);
 assert.equal(all.length,320);assert.equal(new Set(all.map(e=>e.key)).size,320);
 current.forEach(e=>assert(all.some(x=>e.key===x.key)));for(const port of [443,2053,8443])assert(all.some(x=>x.port===port));
});
test('reject wrong range, oversize, wrong HTTP status and truncated non-timeout response',()=>{
 const good={status:206,bytes:2000000,ms:2000,headers:{'content-range':'bytes 100-2000099/200000000'}};
 assert.equal(C.downloadValid(good,100,2000000).mbps,8);
 assert.equal(C.downloadValid({...good,bytes:2500000},100,2000000).valid,false);
 assert.equal(C.downloadValid({...good,status:200},100,2000000).valid,false);
 assert.equal(C.downloadValid({...good,bytes:100000},100,2000000).valid,false);
 assert.equal(C.downloadValid({...good,headers:{'content-range':'bytes 0-1999999/200000000'}},100,2000000).valid,false);
 const p=C.downloadValid({...good,error:'timeout',bytes:100000},100,2000000);assert(p.valid&&p.partial);
 assert.equal(C.downloadValid({...good,error:'connection reset',bytes:100000},100,2000000).valid,false);
});
test('top ten deduplicates IPs and uses conservative scores',()=>{
 const rows=Array.from({length:15},(_,i)=>({ip:'8.35.211.'+(i+1),port:2053,valid:true,score:30-i}));
 rows.push({...rows[0],port:443,score:1});const top=C.topDistinct(rows,10);assert.equal(top.length,10);assert.equal(new Set(top.map(x=>x.ip)).size,10);assert.equal(top[0].port,2053);
});
test('successful end-to-end mock publishes only ADD.txt and verifies both subscription formats',async()=>{
 const f=fixture();const r=await C.execute(f.env,f.opts,pools);
 assert(r.changed&&r.verified);assert.equal(r.selected.length,10);assert.equal(new Set(r.selected.map(x=>x.ip)).size,10);assert.equal(f.posts.length,1);
 assert.equal(r.candidateCount,40);assert(f.calls.some(x=>x[1].endsWith('&surge')));
 assert(r.selected.every(x=>x.samples.length===2));
});
test('converter strips legacy flag prefixes but preserves bracketed countries and unknown marker',()=>{
 for(const flag of ['🇺🇸','🇯🇵','🌐']) {
  assert.equal(convertedName(flag+' CF1-8.35.211.1'),'CF1-8.35.211.1');
  assert.equal(convertedName('【'+flag+'】 CF1-8.35.211.1'),'【'+flag+'】 CF1-8.35.211.1');
 }
});
test('full ranking and rename survive leading-emoji removal with exact names in both subscriptions',async()=>{
 for(const action of [C.execute,C.renameOnly])for(const unknown of [false,true]) {
  const f=fixture({geoipUnknown:unknown}),r=await action(f.env,f.opts,pools);
  assert(r.changed&&r.verified);assert.equal(f.posts.length,1);
  assert(r.selected.every(e=>e.name.startsWith(unknown?'【🌐】 CF':'【🇺🇸】 CF')));
  const cfg=C.configGuard(config(),HOST);
  const raw=C.parseRaw(await f.env.control('GET','/sub?mock&b64'),cfg,pools);
  const surge=C.parseSurge(await f.env.control('GET','/sub?mock&surge'),cfg,pools);
  assert(C.sameNamedEntries(r.selected,raw));assert(C.sameNamedEntries(r.selected,surge));
 }
});
for(const [name,options,pattern] of [
 ['wrong mode',{wrongMode:true},/自定义模式/],['login failure',{loginFail:true},/登录失败/],
 ['no candidates',{allFail:true},/不足 10/],['cancel',{cancel:true},/取消/],
 ['network change',{networkChange:true},/网络变化/],['expired result',{expired:true},/有效期/],
 ['concurrent backend edit',{userChange:true},/后台被改动/],['range ignored',{ignoredRange:true},/Range/]
])test(name+' preserves existing subscription',async()=>{const f=fixture(options);await assert.rejects(()=>C.execute(f.env,f.opts,pools),pattern);assert.equal(f.posts.length,0);});
test('failed post-save subscription validation restores original list when still ours',async()=>{
 const f=fixture({verifyFail:true});await assert.rejects(()=>C.execute(f.env,f.opts,pools),/恢复备份/);assert.equal(f.posts.length,2);assert.equal(f.getList(),f.original);
});
test('raw subscription requires matching credentials and TLS host',()=>{
 const cfg=C.configGuard(config(),HOST);
 assert.throws(()=>C.parseRaw(Buffer.from('trojan://wrong@8.35.211.1:2053?security=tls&type=ws&host=example.net&sni=example.net&path=%2F').toString('base64'),cfg,pools));
});
test('rename preserves every endpoint and order with only small exit-IP probes',async()=>{
 const f=fixture();const probe=f.env.probe;f.env.probe=async spec=>{assert(spec.url.startsWith('https://api.ipify.org?'));return probe(spec);};
 const before=C.parseList(f.original,pools);const r=await C.renameOnly(f.env,f.opts,pools);
 assert(r.changed&&r.verified);assert.equal(f.posts.length,1);
 const after=C.parseList(f.getList(),pools);assert(C.sameEntries(before,after));
 assert.deepEqual(after.map(e=>e.name),Array.from({length:10},(_,i)=>`【🇺🇸】 CF${i+1}-8.35.211.${i+1}`));
 assert.equal(f.geoCalls.length,20);assert(f.geoCalls.every(ip=>ip==='8.8.4.4'));
});
test('rename is idempotent and checks both subscription formats',async()=>{
 const f=fixture({alreadyNamed:true});const r=await C.renameOnly(f.env,f.opts,pools);
 assert(r.verified&&!r.changed);assert.equal(f.posts.length,0);
 assert(f.calls.some(x=>x[1].endsWith('&surge')));
});
for(const [label,options,pattern] of [
 ['nine entries',{count:9},/10 个/],['user edited list',{userChange:true},/后台被改动/],['unsupported mode',{wrongMode:true},/自定义模式/]
])test('rename rejects '+label+' without writes',async()=>{
 const f=fixture(options);await assert.rejects(()=>C.renameOnly(f.env,f.opts,pools),pattern);assert.equal(f.posts.length,0);
});
for(const key of ['rawNameFail','surgeNameFail'])test('unchanged IPs with stale '+key+' cannot pass rename or rank verification',async()=>{
 for(const action of [C.renameOnly,C.execute]) {
  const f=fixture({[key]:true});await assert.rejects(()=>action(f.env,f.opts,pools),/验证失败/);
  assert.equal(f.posts.length,2);assert.equal(f.getList(),f.original);
 }
});
test('exit country comes from two observed public IPs, not the entrance or existing name',async()=>{
 const f=fixture(),e=C.parseList(f.original,pools)[0],cfg=C.configGuard(config(),HOST);let count=0;
 f.env.probe=async spec=>{assert.equal(spec.method,'GET');assert.match(spec.descriptor,new RegExp(e.ip.replace(/\./g,'\\.')));assert.equal(spec.headers.Range,undefined);return {status:200,data:JSON.stringify({ip:++count===1?'8.8.4.4':'1.1.1.1'})};};
 const lookedUp=[];f.env.geoip=ip=>{lookedUp.push(ip);return 'JP';};
 const result=await C.exitCountry(f.env,e,cfg,async()=>{});
 assert.equal(result.country,'JP');assert.deepEqual(lookedUp,['8.8.4.4','1.1.1.1']);
 assert.equal(C.namedEntries([{...e,egress:result}])[0].name,'【🇯🇵】 CF1-8.35.211.1');
});
test('different exit countries are explicitly unknown, never averaged or inherited',async()=>{
 const f=fixture(),e=C.parseList(f.original,pools)[0];let n=0;
 f.env.geoip=()=>++n===1?'JP':'US';
 const result=await C.exitCountry(f.env,e,C.configGuard(config(),HOST),async()=>{});
 assert.equal(result.status,'inconsistent');assert.equal(result.country,null);
 assert.equal(C.namedEntries([{...e,egress:result}])[0].name,'【🌐】 CF1-8.35.211.1');
});
test('private, malformed, timed out, redirected and oversized IP replies cannot get a country flag',async()=>{
 for(const response of [
  {status:200,data:'{"ip":"192.168.1.1"}'},{status:200,data:'{"ip":"203.0.113.1"}'},
  {status:200,data:'<html>challenge</html>'},{status:200,error:'timeout',data:'{"ip":"8.8.4.4"}'},
  {status:302,data:'{"ip":"8.8.4.4"}'},{status:200,data:' '.repeat(1024)+'{"ip":"8.8.4.4"}'}
 ]) {
  const f=fixture();f.env.probe=async()=>response;f.env.geoip=()=>{throw new Error('must not geolocate invalid reply');};
  const result=await C.exitCountry(f.env,C.parseList(f.original,pools)[0],C.configGuard(config(),HOST),async()=>{});
  assert.equal(result.country,null);assert.equal(result.status,'unknown');
 }
});
test('unknown detection replaces an old flag and still preserves every endpoint',async()=>{
 const f=fixture({alreadyNamed:true,geoipUnknown:true});const r=await C.renameOnly(f.env,f.opts,pools);
 assert(r.verified);assert(C.sameEntries(C.parseList(f.original,pools),r.selected));
 assert(r.selected.every(e=>e.name.startsWith('【🌐】 CF')&&e.egress.country===null));
});
test('missing local GeoIP falls back through the same CF node and caches only within the run',async()=>{
 const f=fixture({geoipUnknown:true}),probe=f.env.probe;let lookups=0,observations=0;
 f.env.probe=async spec=>{
  assert.match(spec.descriptor,/^CF-Probe-/);assert.equal(spec.policy,undefined);
  if(spec.url.startsWith('https://api.ipify.org?')){observations++;return probe(spec);}
  assert.equal(spec.url,'https://ipwho.is/8.8.4.4?fields=ip,success,country_code');
  lookups++;return {status:200,data:JSON.stringify({ip:'8.8.4.4',success:true,country_code:'JP'})};
 };
 const first=await C.renameOnly(f.env,f.opts,pools);
 assert(first.verified);assert.equal(observations,20);assert.equal(lookups,1);
 assert(first.selected.every(e=>e.name.startsWith('【🇯🇵】 CF')&&e.egress.samples.every(s=>s.countrySource==='IPWhois')));
 f.env.backup=async b=>assert.equal(b.list,f.getList());
 const second=await C.renameOnly(f.env,f.opts,pools);
 assert(second.verified&&!second.changed);assert.equal(observations,40);assert.equal(lookups,2);
});
test('online GeoIP rejects wrong IP, unsuccessful, rate-limited, malformed and invalid-country replies',async()=>{
 for(const response of [
  {status:200,data:'{"ip":"1.1.1.1","success":true,"country_code":"JP"}'},
  {status:200,data:'{"ip":"8.8.4.4","success":false,"country_code":"JP"}'},
  {status:429,data:'{"ip":"8.8.4.4","success":true,"country_code":"JP"}'},
  {status:200,error:'timeout',data:'{"ip":"8.8.4.4","success":true,"country_code":"JP"}'},
  {status:200,data:'{"ip":"8.8.4.4","success":true,"country_code":"XX"}'},
  {status:200,data:'<html>challenge</html>'}
 ]) {
  const f=fixture({geoipUnknown:true}),probe=f.env.probe;
  f.env.probe=spec=>spec.url.startsWith('https://api.ipify.org?')?probe(spec):Promise.resolve(response);
  const result=await C.exitCountry(f.env,C.parseList(f.original,pools)[0],C.configGuard(config(),HOST),async()=>{});
  assert.equal(result.country,null);assert.equal(result.status,'unknown');
 }
});
test('a failed fallback is retried and cannot lend a country to an unconfirmed observation',async()=>{
 const f=fixture({geoipUnknown:true}),probe=f.env.probe;let lookups=0;
 f.env.probe=spec=>spec.url.startsWith('https://api.ipify.org?')?probe(spec):Promise.resolve(++lookups===1?
  {status:429,data:''}:{status:200,data:'{"ip":"8.8.4.4","success":true,"country_code":"JP"}'});
 const result=await C.exitCountry(f.env,C.parseList(f.original,pools)[0],C.configGuard(config(),HOST),async()=>{});
 assert.equal(lookups,2);assert.equal(result.country,null);assert.equal(result.samples[1].country,'JP');
});
test('cancellation during online lookup prevents a backend write',async()=>{
 const f=fixture({geoipUnknown:true}),probe=f.env.probe;let cancelled=false;
 f.env.cancelled=async()=>cancelled;
 f.env.probe=async spec=>{
  if(spec.url.startsWith('https://api.ipify.org?'))return probe(spec);
  cancelled=true;return {status:200,data:'{"ip":"8.8.4.4","success":true,"country_code":"JP"}'};
 };
 await assert.rejects(()=>C.renameOnly(f.env,f.opts,pools),/取消/);assert.equal(f.posts.length,0);
});
test('network change or cancellation during exit detection prevents any rename',async()=>{
 for(const options of [{networkChange:true},{cancel:true}]) {
  const f=fixture(options);await assert.rejects(()=>C.renameOnly(f.env,f.opts,pools),/网络变化|取消/);assert.equal(f.posts.length,0);
 }
});
test('literal UTF-8 flags and percent-encoded flags both survive raw subscription parsing',()=>{
 const cfg=C.configGuard(config(),HOST);
 for(const name of ['🇯🇵 CF1-8.35.211.1','【🇯🇵】 CF1-8.35.211.1','【🌐】 CF1-8.35.211.1'])for(const fragment of [name,encodeURIComponent(name)]) {
  const raw=`trojan://${PASS}@8.35.211.1:2053?security=tls&type=ws&host=${HOST}&sni=${HOST}&path=%2F#${fragment}`;
  assert.equal(C.parseRaw(Buffer.from(raw).toString('base64'),cfg,pools)[0].name,name);
 }
 assert.equal(C.countryFlag('XX'),'🌐');assert.equal(C.countryFlag('ZZ'),'🌐');assert.equal(C.countryFlag('bad'),'🌐');
});
