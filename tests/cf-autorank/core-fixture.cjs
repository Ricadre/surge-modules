const assert=require('node:assert/strict');
const C=require('../../src/cf-autorank/core.js'),pools=require('../../src/cf-autorank/pools.json');
const convertedName=require('./subconverter-fixture.cjs'),premiumPage=require('./premium-fixture.cjs');
const HOST='example.net',PASS='11111111-1111-4111-8111-111111111111';
function config(){return {HOST,HOSTS:[HOST],UUID:PASS,PATH:'/',协议类型:'trojan',传输协议:'ws',跳过证书验证:false,随机路径:false,启用0RTT:false,ECH:false,优选订阅生成:{local:true,本地IP库:{随机IP:false},TOKEN:'f'.repeat(32)}};}
function fixture(options={}) {
 let list=Array.from({length:options.count||10},(_,i)=>`8.35.211.${i+1}:2053#${options.alreadyNamed?`【🇺🇸】 CF${i+1}-8.35.211.${i+1}`:`CF-YouTube-${String(i+1).padStart(2,'0')}`}`).join('\n');
 if(options.outsideCurrent)list=list.replace('8.35.211.1:2053','9.9.9.9:443');
 const allowedPools=C.includeCurrent(list,pools.concat(options.official||[]));
 const original=list,posts=[],calls=[],progress=[],geoCalls=[];let probes=0,time=1000000,snapshots=0,seed=42,id=0;
 const cfg=config();
 const env={
  now:()=>time,id:()=>String(++id),random:()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;},
  networkKey:()=>options.networkChange&&probes>8?'new':'old',
  geoip:ip=>{geoCalls.push(ip);return options.geoipUnknown?'':'US';},
  cancelled:async()=>options.cancel&&probes>8,
  sleep:async ms=>{time+=ms;},
  progress:async p=>progress.push(structuredClone(p)),backup:async b=>{assert.equal(b.list,original);},
  login:async()=>{if(options.loginFail)throw new Error('登录失败');},
  control:async(method,path,body)=>{
   calls.push([method,path]);
   if(method==='POST'){assert.equal(path,'/admin/ADD.txt');assert.equal(C.parseList(body,allowedPools).length,10);posts.push(body);list=body;return {success:true};}
   if(path==='/admin/config.json'){snapshots++;if(options.userChange&&snapshots===2)list=original.replace('8.35.211.1:','8.35.211.250:');if(options.wrongMode)cfg.优选订阅生成.local=false;return structuredClone(cfg);}
   if(path==='/admin/ADD.txt')return list;
   const entries=C.parseList(list,allowedPools);
   if(path.endsWith('&b64'))return Buffer.from(entries.map(e=>`trojan://${PASS}@${e.key}?security=tls&type=ws&host=${HOST}&sni=${HOST}&path=%2F#${encodeURIComponent(options.rawNameFail&&posts.length===1?'Old name':e.name)}`).join('\n')).toString('base64');
   if(path.endsWith('&surge'))return '[Proxy]\n'+entries.map((e,i)=>`${options.surgeNameFail&&posts.length===1?'Old name':convertedName(e.name)} = trojan, ${options.verifyFail&&posts.length===1?'8.35.211.253':e.ip}, ${e.port}, password=${PASS}, sni=${HOST}, ws=true, ws-path=/, ws-headers=Host:${HOST}, skip-cert-verify=false`).join('\n');
   throw new Error('Unknown path');
  },
  probe:async spec=>{
   probes++;time+=10;
   if(options.expired&&probes>8)time+=3600000;
   assert.match(spec.descriptor,/^CF-Probe-.* = trojan, /);assert.match(spec.descriptor,/skip-cert-verify=false/);
   if(options.allFail)return {error:'timeout',status:0,bytes:0,ms:4000,headers:{}};
   if(spec.url.startsWith('https://www.youtube.com/premium?'))return {status:200,data:premiumPage(),ms:100};
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
module.exports={fixture,config,HOST,PASS,pools};
