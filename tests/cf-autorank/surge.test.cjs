const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../../src/cf-autorank');
const source=fs.readFileSync(path.join(root,'core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'panel.js'),'utf8')+'\nconst CF_RANK_POOLS='+fs.readFileSync(path.join(root,'pools.json'),'utf8')+';\n'+fs.readFileSync(path.join(root,'surge.js'),'utf8');
async function run(argument,trigger='button',seedStore={},harness={}) {
 const store=harness.sharedStore||{...seedStore},logs=[],requests=[],writes=[],states=[];let output,doneCount=0;
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
    const entries=list.split('\n').map(x=>{const [key,name]=x.split('#');return {key,name};});
    if(url.searchParams.has('b64'))data=Buffer.from(entries.map(({key,name})=>`trojan://${uuid}@${key}?security=tls&type=ws&host=${host}&sni=${host}&path=%2F#${encodeURIComponent(name)}`).join('\n')).toString('base64');
    else data='[Proxy]\n'+entries.map(({key,name})=>{const [ip,port]=key.split(':');return `${name} = trojan, ${ip}, ${port}, password=${uuid}, sni=${host}, ws=true, ws-path=/, ws-headers=Host:"${host}", skip-cert-verify=false`;}).join('\n');
   } else throw new Error('unexpected control path');
  } else {
   assert.match(options['policy-descriptor'],/^CF-Probe-.* = trojan,/);assert.equal(options.policy,undefined);assert.equal(options['auto-cookie'],false);
   if(options.headers.Range){const m=/bytes=(\d+)-(\d+)/.exec(options.headers.Range);status=206;data={byteLength:Number(m[2])-Number(m[1])+1};headers={'Content-Range':`bytes ${m[1]}-${m[2]}/200000000`};}
   else status=204;
  }
  if(harness.onRequest)harness.onRequest({method,options,store,requests});
  callback(null,{status,headers},data);
 }
 let settle;const completion=new Promise(resolve=>{settle=resolve;});
 const ctx={console:{log:s=>logs.push(String(s))},Date,Math,Uint8Array,Promise,setTimeout,
  $argument:argument,$trigger:trigger,$input:{purpose:'panel'},$network:harness.network||{v4:{primaryInterface:'pdp_ip0',primaryAddress:'192.0.2.10'}},
  $persistentStore:{read:k=>store[k]||null,write:(v,k)=>{store[k]=v;states.push({key:k,value:JSON.parse(v)});return true;}},
  $notification:{post:()=>{}},$done:r=>{output=r;doneCount++;settle();},
  $httpClient:{get:(o,c)=>client('GET',o,c),post:(o,c)=>client('POST',o,c),head:(o,c)=>client('HEAD',o,c)}};
 vm.runInNewContext(source,ctx);await completion;return {store,logs,requests,writes,output,doneCount,states};
}
test('panel status never makes network requests',async()=>{const r=await run('status|example.net|lite|40|');assert.equal(r.requests.length,0);assert.equal(r.doneCount,1);});
test('missing credentials cannot start measurements or publication',async()=>{const r=await run('start|example.net|lite|40|');assert.equal(r.requests.length,0);assert.match(r.output.content,/密码/);});
test('automatic panel refresh never runs paid traffic or writes',async()=>{const r=await run('start|example.net|lite|40|local-secret','auto-interval');assert.equal(r.requests.length,0);});
test('adapter full mock uses only direct backend and explicit temporary CF policies',async()=>{
 const r=await run('start|example.net|lite|40|local-secret');
 assert.equal(r.output.icon,'cloud.fill');assert.equal(r.output.style,undefined);assert.equal(r.writes.length,1);assert.equal(r.writes[0].split('\n').length,10);assert.equal(r.doneCount,1);
 assert(r.requests.some(x=>x.descriptor));assert(r.requests.every(x=>x.method==='GET'||x.method==='HEAD'||/\/login|\/admin\/ADD.txt/.test(x.url)));
 assert(!JSON.stringify(r.logs).includes('local-secret'));assert(!JSON.stringify(r.store).includes('local-secret'));assert(!JSON.stringify(r.store).includes('11111111-1111-4111-8111-111111111111'));
 assert.match(r.output.content,/上次更新 .*10 节点/);assert.equal(r.output.content.split('\n').length,2);
 assert(!/\d+\.\d+\.\d+\.\d+/.test(r.output.content));assert(r.logs.some(line=>line.includes('Mbps')));
 const verified=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(verified.result.verified,true);
});
test('local active run lock prevents a second run',async()=>{
 const active=JSON.stringify({running:true,stage:'下载初筛',done:8,total:40,bytes:1000000,updatedAt:Date.now()});
 const r=await run('start|example.net|lite|40|local-secret','button',{'CFEdgeRank_example.net':active});
 assert.equal(r.requests.length,0);assert.equal(r.output.title,'Cloudflare 一键优选');assert.equal(r.store['CFEdgeRank_example.net'],active);
});
test('passive panel refresh displays previous result without restarting a run',async()=>{
 const state=JSON.stringify({running:false,stage:'完成',bytes:123000000,updatedAt:Date.now(),result:{changed:true,selected:Array.from({length:10},(_,i)=>({key:'8.35.211.'+(i+1)+':2053',score:8}))}});
 const r=await run('start|example.net|lite|40|local-secret','auto-interval',{'CFEdgeRank_example.net':state});
 assert.equal(r.requests.length,0);assert.equal(r.writes.length,0);assert.match(r.output.content,/上次更新 .*10 节点/);assert.equal(r.store['CFEdgeRank_example.net'],state);
});
test('cancel stays available from scripts without making any backend request',async()=>{
 const r=await run('cancel|example.net|lite|40|','intent',{'CFEdgeRank_example.net':JSON.stringify({running:true,stage:'下载初筛',updatedAt:Date.now()})});
 assert.equal(r.requests.length,0);assert.equal(JSON.parse(r.store['CFEdgeRank_example.net']).cancelRequested,true);
});
test('returning to status reads the saved in-flight progress without credentials or requests',async()=>{
 const key='CFEdgeRank_example.net';let check;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {onRequest:({options,store})=>{
  if(options['policy-descriptor']&&!check)check=run('status|example.net|lite|40|','auto-interval',{}, {sharedStore:store});
 }});
 const status=await check;
 assert.equal(status.requests.length,0);assert.match(status.output.content,/连通检查/);
 assert.equal(status.output.title,'Cloudflare 测速进度');assert.equal(r.writes.length,1);
});
test('a failed later run preserves last success time and network for the overview',async()=>{
 const key='CFEdgeRank_example.net';
 const lastSuccess={at:Date.now()-3600000,network:{kind:'wifi',name:'Earlier Wi-Fi'},mode:'lite',count:10,bytes:100000000,changed:true};
 const r=await run('start|example.net|lite|40|local-secret','button',{[key]:JSON.stringify({lastSuccess})},{network:{wifi:{ssid:'New Wi-Fi'}},onRequest:({options,store})=>{
  if(options['policy-descriptor']){const s=JSON.parse(store[key]);store[key]=JSON.stringify({...s,cancelRequested:true});}
 }});
 assert.equal(r.writes.length,0);assert.deepEqual(JSON.parse(r.store[key]).lastSuccess,lastSuccess);
 const overview=await run('start|example.net|lite|40|','auto-interval',r.store);
 assert.match(overview.output.content,/Earlier Wi-/);assert(!overview.output.content.includes('New Wi-Fi'));
});
test('superseded callback cannot overwrite a newer run or publish its old results',async()=>{
 const key='CFEdgeRank_example.net';const newer=JSON.stringify({running:true,ownerId:'newer-run',updatedAt:Date.now(),stage:'准备'});let replaced=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {onRequest:({options,store})=>{
  if(options['policy-descriptor']&&!replaced){replaced=true;store[key]=newer;}
 }});
 assert.equal(r.writes.length,0);assert.equal(r.store[key],newer);
});
test('manual restart replaces a stale run and saves successful network metadata',async()=>{
 const key='CFEdgeRank_example.net';
 const r=await run('start|example.net|lite|40|local-secret','button',{[key]:JSON.stringify({running:true,ownerId:'old',updatedAt:Date.now()-240000,stage:'下载初筛'})},{network:{wifi:{ssid:'Test Wi-Fi'}}});
 const saved=JSON.parse(r.store[key]);assert.notEqual(saved.ownerId,'old');assert.equal(saved.running,false);
 assert.equal(saved.lastSuccess.network.name,'Test Wi-Fi');assert.equal(r.writes.length,1);
 assert(r.states.some(x=>x.key===key&&x.value.running&&x.value.network.name==='Test Wi-Fi'));
});
test('rename action uses direct backend only and preserves previous speed-test history',async()=>{
 const lastSuccess={at:Date.now()-3600000,network:{kind:'wifi',name:'Earlier Wi-Fi'},mode:'lite',count:10,bytes:100000000,changed:true};
 const r=await run('rename|example.net|lite|40|local-secret','editor',{'CFEdgeRank_example.net':JSON.stringify({lastSuccess})});
 assert.equal(r.writes.length,1);assert(r.requests.every(x=>x.policy==='DIRECT'&&!x.descriptor));
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(state.running,false);assert.equal(state.stage,'名称已核对');
 assert.deepEqual(state.lastSuccess,lastSuccess);assert.equal(state.nameResult.verified,true);
 assert.match(r.writes[0],/^8\.35\.211\.1:2053#CF1-8\.35\.211\.1\n/);
});
test('automatic refresh never renames the backend',async()=>{
 const r=await run('rename|example.net|lite|40|local-secret','auto-interval');
 assert.equal(r.requests.length,0);assert.equal(r.writes.length,0);
});
test('published module has static fallback panels and resolves every action to its versioned bundle',()=>{
 const base=path.resolve(root,'../..'),moduleText=fs.readFileSync(path.join(base,'modules/CF-AutoRank.sgmodule'),'utf8');
 const version=/^#!version=(.+)$/m.exec(moduleText)[1];
 const panelLines=moduleText.split('[Panel]')[1].trim().split('\n');assert.equal(panelLines.length,2);
 const scriptLines=moduleText.split('[Script]')[1].split('[Panel]')[0].trim().split('\n').filter(Boolean);
 assert.equal(scriptLines.length,5);
 const scripts=new Set(scriptLines.map(l=>l.split('=')[0].trim()));
 for(const line of panelLines){assert.match(line,/title=".+",content=".+",style=info/);assert(scripts.has(/script-name=([^,]+)/.exec(line)[1]));}
 for(const line of scriptLines)assert(line.includes('/scripts/CF-AutoRank-'+version+'.js,'));
 assert.equal(fs.readFileSync(path.join(base,'scripts/CF-AutoRank-'+version+'.js'),'utf8'),fs.readFileSync(path.join(base,'scripts/CF-AutoRank.js'),'utf8'));
});
