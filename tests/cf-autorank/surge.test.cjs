const convertedName=require('./subconverter-fixture.cjs');
const premiumPage=require('./premium-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../../src/cf-autorank');
const source=fs.readFileSync(path.join(root,'youtube-premium.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pool-source.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'panel.js'),'utf8')+'\nconst CF_RANK_POOLS='+fs.readFileSync(path.join(root,'pools.json'),'utf8')+';\nconst CF_RANK_OFFICIAL='+fs.readFileSync(path.join(root,'official-pools.json'),'utf8')+';\n'+fs.readFileSync(path.join(root,'surge.js'),'utf8');
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
    else data='[Proxy]\n'+entries.map(({key,name})=>{const [ip,port]=key.split(':');return `${convertedName(name)} = trojan, ${ip}, ${port}, password=${uuid}, sni=${host}, ws=true, ws-path=/, ws-headers=Host:"${host}", skip-cert-verify=false`;}).join('\n');
   } else throw new Error('unexpected control path');
  } else if(options.url==='https://www.cloudflare.com/ips-v4'||options.url==='https://api.cloudflare.com/client/v4/ips') {
   assert.equal(options.policy,'DIRECT');assert.equal(options['policy-descriptor'],undefined);assert.equal(options['auto-cookie'],false);assert.equal(options['auto-redirect'],false);assert.equal(options.body,undefined);
   const official=JSON.parse(fs.readFileSync(path.join(root,'official-pools.json'),'utf8'));
   const failed=harness.poolFail||(harness.primaryPoolFail&&options.url.includes('www.cloudflare.com'));
   status=failed?403:200;data=failed?'blocked':options.url.includes('api.cloudflare.com')?JSON.stringify({success:true,result:{ipv4_cidrs:official}}):official.join('\n');
  } else {
   assert.match(options['policy-descriptor'],/^CF-Probe-.* = trojan,/);assert.equal(options.policy,undefined);assert.equal(options['auto-cookie'],false);
   if(options.headers.Range){const m=/bytes=(\d+)-(\d+)/.exec(options.headers.Range);status=206;data={byteLength:Number(m[2])-Number(m[1])+1};headers={'Content-Range':`bytes ${m[1]}-${m[2]}/200000000`};}
   else if(options.url.startsWith('https://api.ipify.org?')){status=200;data=JSON.stringify({ip:'8.8.4.4'});}
   else if(options.url.startsWith('https://www.youtube.com/premium?')){status=200;data=premiumPage(harness.premiumUnavailable?{unavailable:true}:{});assert.equal(options['auto-redirect'],false);assert.equal(options.headers.Cookie,undefined);}
   else if(options.url==='https://ipwho.is/8.8.4.4?fields=ip,success,country_code'){status=200;data=JSON.stringify({ip:'8.8.4.4',success:true,country_code:'JP'});}
   else status=204;
  }
  if(harness.onRequest)harness.onRequest({method,options,store,requests});
  callback(null,{status,headers},data);
 }
 let settle;const completion=new Promise(resolve=>{settle=resolve;});
 const ctx={console:{log:s=>logs.push(String(s))},Date,Math,Uint8Array,Promise,setTimeout,
  $utils:{geoip:ip=>{assert.equal(ip,'8.8.4.4');return harness.noGeoIP?null:'US';}},
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
 assert.equal(verified.result.premium.verified,10);assert.equal(verified.lastSuccess.premiumVerified,10);
 assert(verified.result.selected.every(e=>e.premium.samples.length===3));
 const premiumRequests=r.requests.filter(x=>x.url.startsWith('https://www.youtube.com/premium?'));
 assert.equal(premiumRequests.length,30);assert(premiumRequests.every(x=>x.descriptor&&!x.policy));
 assert.match(r.output.content,/YT✓/);
 assert(verified.result.selected.every(e=>e.name.startsWith('【🇺🇸】 CF')));
 assert.equal(r.requests.filter(x=>x.url.startsWith('https://api.ipify.org?')).length,20);
 assert.equal(verified.poolInfo.source,'live-text');
 assert.equal(verified.result.candidateSources.current,10);
 assert.equal(verified.result.candidateSources.official,953);
 assert.equal(verified.result.candidateSources.legacy,317);
 assert.equal(verified.result.candidateCount,1280);assert.equal(verified.result.downloadCandidateCount,40);
 const light=r.requests.filter(x=>x.url.includes('cf_rank_light='));assert.equal(light.length,2560);
 assert(light.every(x=>x.method==='HEAD'&&x.descriptor&&!x.policy));
});
test('Premium failure never updates backend and preserves the previous successful record',async()=>{
 const key='CFEdgeRank_example.net',lastSuccess={at:Date.now()-3600000,network:{kind:'cellular'},count:10,bytes:1000,changed:true,mode:'lite'};
 const r=await run('start|example.net|lite|40|local-secret','button',{[key]:JSON.stringify({lastSuccess})},{premiumUnavailable:true});
 assert.equal(r.writes.length,0);const saved=JSON.parse(r.store[key]);assert.equal(saved.running,false);assert.equal(saved.stage,'未完成');
 assert.deepEqual(saved.lastSuccess,lastSuccess);assert.equal(saved.premium.passed,0);assert.equal(saved.premium.unavailable,24);
 assert.match(r.output.content,/Premium 合格 0\/10/);assert(!r.output.content.includes('YT✓'));
});
test('adapter refreshes official data each run even when a valid cache already exists',async()=>{
 const sharedStore={};
 for(let i=0;i<2;i++) {
  const r=await run('start|example.net|lite|40|local-secret','button',{}, {sharedStore});
  assert.equal(r.requests.filter(x=>x.url==='https://www.cloudflare.com/ips-v4').length,1);
  assert.equal(JSON.parse(sharedStore['CFEdgeRank_example.net']).result.verified,true);
 }
 const cache=JSON.parse(sharedStore['CFEdgeRank_example.net_poolcache']);assert.equal(cache.ranges.length,15);
 assert(!JSON.stringify(cache).includes('local-secret'));
});
test('adapter uses official fallback, recent cache or built-in ranges without extra panels',async()=>{
 const key='CFEdgeRank_example.net_poolcache',ranges=JSON.parse(fs.readFileSync(path.join(root,'official-pools.json'),'utf8'));
 for(const [harness,seed,expected] of [
  [{primaryPoolFail:true},{},'live-api'],
  [{poolFail:true},{[key]:JSON.stringify({version:1,url:'https://www.cloudflare.com/ips-v4',fetchedAt:Date.now(),ranges})},'cache'],
  [{poolFail:true},{},'bundled']
 ]) {
  const r=await run('start|example.net|lite|40|local-secret','button',seed,harness);
  const state=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(state.poolInfo.source,expected);
  assert.equal(state.result.verified,true);assert.equal(r.writes.length,1);assert.equal(r.output.content.split('\n').length,2);
 }
});
test('cancel or change network while refreshing pool prevents login, probes and publication',async()=>{
 for(const kind of ['cancel','network']) {
  const network={wifi:{ssid:'First'}};
  const r=await run('start|example.net|lite|40|local-secret','button',{}, {network,onRequest:({options,store})=>{
   if(options.url!=='https://www.cloudflare.com/ips-v4')return;
   if(kind==='network')network.wifi.ssid='Second';
   else {const key='CFEdgeRank_example.net';store[key]=JSON.stringify({...JSON.parse(store[key]),cancelRequested:true});}
  }});
  assert.equal(r.requests.length,1);assert.equal(r.writes.length,0);assert.equal(r.store['CFEdgeRank_example.net_poolcache'],undefined);
  assert.match(r.output.content,/取消|网络变化/);
 }
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
 assert.equal(status.requests.length,0);assert.match(status.output.content,/轻量初筛/);
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
test('rename uses explicit CF exit probes and direct backend while preserving speed-test history',async()=>{
 const lastSuccess={at:Date.now()-3600000,network:{kind:'wifi',name:'Earlier Wi-Fi'},mode:'lite',count:10,bytes:100000000,changed:true};
 const r=await run('rename|example.net|lite|40|local-secret','editor',{'CFEdgeRank_example.net':JSON.stringify({lastSuccess})});
 assert.equal(r.writes.length,1);assert(r.requests.filter(x=>x.url.startsWith('https://example.net/')).every(x=>x.policy==='DIRECT'&&!x.descriptor));
 const probes=r.requests.filter(x=>x.url.startsWith('https://api.ipify.org?'));assert.equal(probes.length,20);assert(probes.every(x=>x.descriptor&&!x.policy));
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(state.running,false);assert.equal(state.stage,'名称已核对');
 assert.deepEqual(state.lastSuccess,lastSuccess);assert.equal(state.nameResult.verified,true);
 assert.match(r.writes[0],/^8\.35\.211\.1:2053#【🇺🇸】 CF1-8\.35\.211\.1\n/);
});
test('automatic refresh never renames the backend',async()=>{
 const r=await run('rename|example.net|lite|40|local-secret','auto-interval');
 assert.equal(r.requests.length,0);assert.equal(r.writes.length,0);
});
test('adapter supports online country lookup when the native GeoIP database is empty',async()=>{
 const r=await run('rename|example.net|lite|40|local-secret','editor',{}, {noGeoIP:true});
 const lookups=r.requests.filter(x=>x.url.startsWith('https://ipwho.is/'));
 assert.equal(lookups.length,1);assert(lookups[0].descriptor&&!lookups[0].policy);
 assert.equal(r.writes.length,1);assert.match(r.writes[0],/#【🇯🇵】 CF1-/);
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(state.nameResult.verified,true);
});
test('published module has static fallback panels and resolves every action to its versioned bundle',()=>{
 const base=path.resolve(root,'../..'),moduleText=fs.readFileSync(path.join(base,'modules/CF-AutoRank.sgmodule'),'utf8');
 const version=/^#!version=(.+)$/m.exec(moduleText)[1];
 assert.match(moduleText,/^#!arguments=backend,mode:lite,candidates:160,admin_password$/m);
 const panelLines=moduleText.split('[Panel]')[1].trim().split('\n');assert.equal(panelLines.length,2);
 const scriptLines=moduleText.split('[Script]')[1].split('[Panel]')[0].trim().split('\n').filter(Boolean);
 assert.equal(scriptLines.length,5);
 const scripts=new Set(scriptLines.map(l=>l.split('=')[0].trim()));
 for(const line of panelLines){assert.match(line,/title=".+",content=".+",style=info/);assert(scripts.has(/script-name=([^,]+)/.exec(line)[1]));}
 for(const line of scriptLines)assert(line.includes('/scripts/CF-AutoRank-'+version+'.js,'));
 assert.equal(fs.readFileSync(path.join(base,'scripts/CF-AutoRank-'+version+'.js'),'utf8'),fs.readFileSync(path.join(base,'scripts/CF-AutoRank.js'),'utf8'));
});
