const test=require('node:test');const assert=require('node:assert/strict');const C=require('../../src/cf-autorank/core.js');const pools=require('../../src/cf-autorank/pools.json');
const HOST='example.net',PASS='11111111-1111-4111-8111-111111111111';
function config(){return {HOST,HOSTS:[HOST],UUID:PASS,PATH:'/',协议类型:'trojan',传输协议:'ws',跳过证书验证:false,随机路径:false,启用0RTT:false,ECH:false,优选订阅生成:{local:true,本地IP库:{随机IP:false},TOKEN:'f'.repeat(32)}};}
function fixture(options={}) {
 let list=Array.from({length:10},(_,i)=>`8.35.211.${i+1}:2053#CF-YouTube-${String(i+1).padStart(2,'0')}`).join('\n');
 const original=list,posts=[],calls=[],progress=[];let probes=0,time=1000000,snapshots=0,seed=42,id=0;
 const cfg=config();
 const env={
  now:()=>time,id:()=>String(++id),random:()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;},
  networkKey:()=>options.networkChange&&probes>8?'new':'old',
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
   if(path.endsWith('&b64'))return Buffer.from(entries.map(e=>`trojan://${PASS}@${e.key}?security=tls&type=ws&host=${HOST}&sni=${HOST}&path=%2F#CF`).join('\n')).toString('base64');
   if(path.endsWith('&surge'))return '[Proxy]\n'+entries.map((e,i)=>`CF-${i} = trojan, ${options.verifyFail&&posts.length===1?'8.35.211.253':e.ip}, ${e.port}, password=${PASS}, sni=${HOST}, ws=true, ws-path=/, ws-headers=Host:${HOST}, skip-cert-verify=false`).join('\n');
   throw new Error('Unknown path');
  },
  probe:async spec=>{
   probes++;time+=10;
   if(options.expired&&probes>8)time+=3600000;
   assert.match(spec.descriptor,/^CF-Probe-.* = trojan, /);assert.match(spec.descriptor,/skip-cert-verify=false/);
   if(options.allFail)return {error:'timeout',status:0,bytes:0,ms:4000,headers:{}};
   if(spec.headers.Range){const m=/bytes=(\d+)-(\d+)/.exec(spec.headers.Range);const size=Number(m[2])-Number(m[1])+1;
    if(options.ignoredRange)return {status:200,bytes:size,ms:100,headers:{}};
    return {status:206,bytes:size,ms:100+(probes%13)*10,headers:{'Content-Range':`bytes ${m[1]}-${m[2]}/200000000`}};
   }
   return {status:204,ms:250,error:null,headers:{}};
  }
 };
 return {env,opts:{host:HOST,password:'local-only',limit:40,mode:'lite'},posts,calls,original,progress,getList:()=>list};
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
