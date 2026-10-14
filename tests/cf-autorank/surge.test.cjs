const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../../src/cf-autorank');
const source=fs.readFileSync(path.join(root,'core.js'),'utf8')+'\nconst CF_RANK_POOLS='+fs.readFileSync(path.join(root,'pools.json'),'utf8')+';\n'+fs.readFileSync(path.join(root,'surge.js'),'utf8');
async function run(argument,trigger='button',seedStore={}) {
 const store={...seedStore},logs=[],requests=[],writes=[];let output,doneCount=0;
 const host='example.net',uuid='11111111-1111-4111-8111-111111111111';
 let list=Array.from({length:10},(_,i)=>`8.35.211.${i+1}:2053#Original-${String(i+1).padStart(2,'0')}`).join('\n');
 const config={HOST:host,HOSTS:[host],UUID:uuid,PATH:'/',协议类型:'trojan',传输协议:'ws',跳过证书验证:false,随机路径:false,启用0RTT:false,ECH:false,优选订阅生成:{local:true,本地IP库:{随机IP:false},TOKEN:'f'.repeat(32)}};
 function client(method,options,callback){
  requests.push({method,url:options.url,policy:options.policy,descriptor:!!options['policy-descriptor']});
  let data='',status=200,headers={};
  if(options.url.startsWith('https://example.net/')){
   assert.equal(options.policy,'DIRECT');assert.equal(options['auto-redirect'],false);assert.equal(options['auto-cookie'],true);
   const url=new URL(options.url);
   if(url.pathname==='/login'){assert.equal(method,'POST');assert.equal(options.body,'password=local-secret');data=JSON.stringify({success:true});}
   else if(url.pathname==='/admin/config.json'){assert.equal(method,'GET');data=JSON.stringify(config);}
   else if(url.pathname==='/admin/ADD.txt'){if(method==='POST'){list=options.body;writes.push(list);data=JSON.stringify({success:true});}else data=list;}
   else if(url.pathname==='/sub'){
    const entries=list.split('\n').map(x=>x.split('#')[0]);
    if(url.searchParams.has('b64'))data=Buffer.from(entries.map(key=>`trojan://${uuid}@${key}?security=tls&type=ws&host=${host}&sni=${host}&path=%2F#CF`).join('\n')).toString('base64');
    else data='[Proxy]\n'+entries.map((key,i)=>{const [ip,port]=key.split(':');return `CF-${i} = trojan, ${ip}, ${port}, password=${uuid}, sni=${host}, ws=true, ws-path=/, ws-headers=Host:"${host}", skip-cert-verify=false`;}).join('\n');
   } else throw new Error('unexpected control path');
  } else {
   assert.match(options['policy-descriptor'],/^CF-Probe-.* = trojan,/);assert.equal(options.policy,undefined);assert.equal(options['auto-cookie'],false);
   if(options.headers.Range){const m=/bytes=(\d+)-(\d+)/.exec(options.headers.Range);status=206;data={byteLength:Number(m[2])-Number(m[1])+1};headers={'Content-Range':`bytes ${m[1]}-${m[2]}/200000000`};}
   else status=204;
  }
  callback(null,{status,headers},data);
 }
 let settle;const completion=new Promise(resolve=>{settle=resolve;});
 const ctx={console:{log:s=>logs.push(String(s))},Date,Math,Uint8Array,Promise,setTimeout,
  $argument:argument,$trigger:trigger,$input:{purpose:'panel'},$network:{v4:{primaryInterface:'pdp_ip0',primaryAddress:'192.0.2.10'}},
  $persistentStore:{read:k=>store[k]||null,write:(v,k)=>{store[k]=v;return true;}},
  $notification:{post:()=>{}},$done:r=>{output=r;doneCount++;settle();},
  $httpClient:{get:(o,c)=>client('GET',o,c),post:(o,c)=>client('POST',o,c),head:(o,c)=>client('HEAD',o,c)}};
 vm.runInNewContext(source,ctx);await completion;return {store,logs,requests,writes,output,doneCount};
}
test('panel status never makes network requests',async()=>{const r=await run('status|example.net|lite|40|');assert.equal(r.requests.length,0);assert.equal(r.doneCount,1);});
test('missing credentials cannot start measurements or publication',async()=>{const r=await run('start|example.net|lite|40|');assert.equal(r.requests.length,0);assert.match(r.output.content,/密码/);});
test('automatic panel refresh never runs paid traffic or writes',async()=>{const r=await run('start|example.net|lite|40|local-secret','auto-interval');assert.equal(r.requests.length,0);});
test('adapter full mock uses only direct backend and explicit temporary CF policies',async()=>{
 const r=await run('start|example.net|lite|40|local-secret');
 assert.equal(r.output.style,'info');assert.equal(r.writes.length,1);assert.equal(r.writes[0].split('\n').length,10);assert.equal(r.doneCount,1);
 assert(r.requests.some(x=>x.descriptor));assert(r.requests.every(x=>x.method==='GET'||x.method==='HEAD'||/\/login|\/admin\/ADD.txt/.test(x.url)));
 assert(!JSON.stringify(r.logs).includes('local-secret'));assert(!JSON.stringify(r.store).includes('local-secret'));assert(!JSON.stringify(r.store).includes('11111111-1111-4111-8111-111111111111'));
});
test('local active run lock prevents a second run',async()=>{
 const r=await run('start|example.net|lite|40|local-secret','button',{'CFEdgeRank_example.net':JSON.stringify({running:true,updatedAt:Date.now()})});assert.equal(r.requests.length,0);assert.match(r.output.content,/已有测试/);
});
