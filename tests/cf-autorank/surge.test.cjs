const convertedName=require('./subconverter-fixture.cjs');
const premiumPage=require('./premium-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../../src/cf-autorank');
const source=fs.readFileSync(path.join(root,'youtube-premium.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pool-source.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'panel.js'),'utf8')+'\nconst CF_RANK_POOLS='+fs.readFileSync(path.join(root,'pools.json'),'utf8')+';\nconst CF_RANK_OFFICIAL='+fs.readFileSync(path.join(root,'official-pools.json'),'utf8')+';\n'+fs.readFileSync(path.join(root,'surge.js'),'utf8');
async function run(argument,trigger='button',seedStore={},harness={}) {
 const store=harness.sharedStore||{...seedStore},logs=[],requests=[],writes=[],states=[],notifications=[],storageOps={reads:0,writes:0};let output,doneCount=0;
 const host='example.net',uuid='11111111-1111-4111-8111-111111111111';
 let list=Array.from({length:10},(_,i)=>`8.35.211.${i+1}:2053#Original-${String(i+1).padStart(2,'0')}`).join('\n');
 const config={HOST:host,HOSTS:[host],UUID:uuid,PATH:'/',协议类型:'trojan',传输协议:'ws',跳过证书验证:false,随机路径:false,启用0RTT:false,ECH:false,优选订阅生成:{local:true,本地IP库:{随机IP:false},TOKEN:'f'.repeat(32)}};
 function client(method,options,callback){
  requests.push({method,url:options.url,policy:options.policy,descriptor:!!options['policy-descriptor']});
  const fault=harness.respond&&harness.respond({method,options,store,requests,writes});
  if(fault){callback(fault.error||null,{status:fault.status||0,headers:fault.headers||{}},fault.data||'');return;}
  let data='',status=200,headers={};
  if(options.url.startsWith('https://example.net/')){
   assert([undefined,'DIRECT'].includes(options.policy));assert.equal(options['policy-descriptor'],undefined);assert.equal(options.insecure,undefined);assert.equal(options['auto-redirect'],false);assert.equal(options['auto-cookie'],true);
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
  const lost=harness.afterResponse&&harness.afterResponse({method,options,store,requests,writes});
  if(lost){callback(lost.error||null,{status:lost.status||0,headers:lost.headers||{}},lost.data||'');return;}
  callback(null,{status,headers},data);
 }
 let settle;const completion=new Promise(resolve=>{settle=resolve;});
 const HarnessDate=harness.clock?class extends Date{static now(){return harness.clock.now();}}:Date;
 const ctx={console:{log:s=>logs.push(String(s))},Date:HarnessDate,Math,Uint8Array,Promise,setTimeout:harness.fastTimers?(fn)=>setTimeout(fn,0):setTimeout,
  $utils:{geoip:ip=>{assert.equal(ip,'8.8.4.4');return harness.noGeoIP?null:'US';}},
  $argument:argument,$trigger:trigger,$input:{purpose:'panel'},$network:harness.network||{v4:{primaryInterface:'pdp_ip0',primaryAddress:'192.0.2.10'}},
  $persistentStore:{read:k=>{storageOps.reads++;if(harness.storageCost)harness.clock.advance(harness.storageCost.read);return store[k]||null;},write:(v,k)=>{storageOps.writes++;if(harness.storageCost)harness.clock.advance(harness.storageCost.write);store[k]=v;states.push({key:k,value:JSON.parse(v)});if(harness.onWrite)harness.onWrite({key:k,value:JSON.parse(v),store,states});return true;}},
  $notification:{post:(title,subtitle,body,options)=>notifications.push({title,subtitle,body,options})},$done:r=>{output=r;doneCount++;settle();},
  $httpClient:{get:(o,c)=>client('GET',o,c),post:(o,c)=>client('POST',o,c),head:(o,c)=>client('HEAD',o,c)}};
 vm.runInNewContext(source,ctx);await completion;return {store,logs,requests,writes,output,doneCount,states,notifications,storageOps};
}
test('panel status never makes network requests',async()=>{const r=await run('status|example.net|lite|40|');assert.equal(r.requests.length,0);assert.equal(r.doneCount,1);});
test('missing credentials cannot start measurements or publication',async()=>{const r=await run('start|example.net|lite|40|');assert.equal(r.requests.length,0);assert.match(r.output.content,/密码/);});
test('automatic panel refresh never runs paid traffic or writes',async()=>{const r=await run('start|example.net|lite|40|local-secret','auto-interval');assert.equal(r.requests.length,0);});
test('adapter full mock uses only direct backend and explicit temporary CF policies',async()=>{
 const r=await run('start|example.net|lite|40|local-secret');
 assert.equal(r.output.icon,'cloud.fill');assert.equal(r.output.style,undefined);assert.equal(r.writes.length,1);assert.equal(r.writes[0].split('\n').length,10);assert.equal(r.doneCount,1);
 assert(r.requests.filter(x=>x.url.startsWith('https://example.net/')).every(x=>x.policy==='DIRECT'));
 assert(r.requests.some(x=>x.descriptor));assert(r.requests.every(x=>x.method==='GET'||x.method==='HEAD'||/\/login|\/admin\/ADD.txt/.test(x.url)));
 assert(!JSON.stringify(r.logs).includes('local-secret'));assert(!JSON.stringify(r.store).includes('local-secret'));assert(!JSON.stringify(r.store).includes('11111111-1111-4111-8111-111111111111'));
 assert.match(r.output.content,/上次更新 .*10 节点/);assert.equal(r.output.content.split('\n').length,2);
 assert(!/\d+\.\d+\.\d+\.\d+/.test(r.output.content));assert(r.logs.some(line=>line.includes('Mbps')));
 const verified=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(verified.result.verified,true);
 assert.equal(verified.result.premium.verified,10);assert.equal(verified.lastSuccess.premiumVerified,10);
 assert(verified.result.selected.every(e=>e.premium.samples.length===3));
 const premiumRequests=r.requests.filter(x=>x.url.startsWith('https://www.youtube.com/premium?'));
 assert.equal(premiumRequests.length,58);assert(premiumRequests.every(x=>x.descriptor&&!x.policy));
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
 assert.deepEqual(saved.lastSuccess,lastSuccess);assert.equal(saved.premium.passed,0);assert.equal(saved.premium.unavailable,40);
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

test('transient pre-publication backend read retries directly without repeating measurements',async()=>{
 let failed=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({method,options,requests})=>{
  if(!failed&&method==='GET'&&options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor)){
   failed=true;return {status:502,data:'private diagnostic must not escape'};
  }
 }});
 assert(failed);assert.equal(r.writes.length,1);
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(state.result.verified,true);
 assert.equal(r.requests.filter(x=>x.url.includes('cf_rank_light=')).length,2560);
 assert(r.requests.filter(x=>x.url.startsWith('https://example.net/')).every(x=>x.policy==='DIRECT'&&!x.descriptor));
 assert(r.logs.some(x=>x.includes('读取后台配置 · 重试 2/3')));
 assert(!r.logs.join('\n').includes('private diagnostic'));
});

test('exhausted backend retries retain the failure stage and original subscription',async()=>{
 let failures=0;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,requests})=>{
  if(options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor)){
   failures++;return {error:'timeout for token='+'f'.repeat(32)+' local-secret',status:0};
  }
 }});
 assert.equal(failures,3);assert.equal(r.writes.length,0);
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);
 assert.equal(state.stage,'未完成');assert.equal(state.failureStage,'发布前核对');
 assert.match(state.message,/读取后台配置失败.*请求超时.*3 次/);
 const status=await run('status|example.net|lite|40|','button',r.store);
 assert.match(status.output.content,/发布前核对/);assert.equal(status.requests.length,0);
 const exposed=JSON.stringify([r.logs,r.store,r.output]);
 for(const secret of ['local-secret','f'.repeat(32),'11111111-1111-4111-8111-111111111111'])assert(!exposed.includes(secret));
});

test('expired admin session is renewed once for a read without following redirects',async()=>{
 let expired=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({options,requests})=>{
  if(!expired&&options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor)){
   expired=true;return {status:302,headers:{Location:'https://untrusted.example/login'}};
  }
 }});
 assert.equal(r.requests.filter(x=>x.url.endsWith('/login')).length,2);
 assert.equal(r.writes.length,1);assert.equal(JSON.parse(r.store['CFEdgeRank_example.net']).result.verified,true);
 assert(!r.requests.some(x=>x.url.startsWith('https://untrusted.example/')));
});

test('persistent login rejection and forbidden responses are bounded and do not write',async()=>{
 for(const code of [302,401,403]){
  const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({options})=>{
   if(options.url.includes('/admin/config.json'))return {status:code,data:'secret challenge response'};
  }});
  assert.equal(r.writes.length,0);
  assert.equal(r.requests.filter(x=>x.url.includes('/admin/config.json')).length,code===403?1:2);
  assert.equal(r.requests.filter(x=>x.url.endsWith('/login')).length,code===403?1:2);
  assert.match(r.output.content,new RegExp('HTTP '+code));
  assert(!JSON.stringify([r.store,r.logs]).includes('secret challenge'));
 }
});

test('transient converted-subscription failure after saving is retried instead of rolled back',async()=>{
 let failed=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,writes})=>{
  if(!failed&&writes.length&&options.url.includes('&surge')){failed=true;return {status:503};}
 }});
 assert(failed);assert.equal(r.writes.length,1);assert.equal(JSON.parse(r.store['CFEdgeRank_example.net']).result.verified,true);
});

test('lost save response is reconciled by readback and both subscriptions without a second save',async()=>{
 let lost=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {afterResponse:({method,options})=>{
  if(!lost&&method==='POST'&&options.url.includes('/admin/ADD.txt')){lost=true;return {error:'timeout'};}
 }});
 assert(lost);assert.equal(JSON.parse(r.store['CFEdgeRank_example.net']).backendRoute,'rules');
 const saveIndex=r.requests.findIndex(x=>x.method==='POST'&&x.url.includes('/admin/ADD.txt'));
 assert(r.requests.slice(saveIndex+1).filter(x=>x.url.startsWith('https://example.net/')).every(x=>x.policy===undefined));
 assert(lost);assert.equal(r.writes.length,1);assert.equal(JSON.parse(r.store['CFEdgeRank_example.net']).result.verified,true);
 assert.equal(r.requests.filter(x=>x.method==='POST'&&x.url.includes('/admin/ADD.txt')).length,1);
 assert(r.requests.some(x=>x.url.includes('&b64'))&&r.requests.some(x=>x.url.includes('&surge')));
});

test('failed save that was never applied is not blindly retried or reported successful',async()=>{
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({method,options})=>{
  if(method==='POST'&&options.url.includes('/admin/ADD.txt'))return {error:'timeout'};
 }});
 assert.equal(r.writes.length,0);assert.equal(r.requests.filter(x=>x.method==='POST'&&x.url.includes('/admin/ADD.txt')).length,1);
 const state=JSON.parse(r.store['CFEdgeRank_example.net']);
 assert.equal(state.stage,'未完成');assert.equal(state.failureStage,'保存与订阅验证');
 assert.match(state.message,/发布验证失败.*保存节点失败.*请求超时/);
});

test('network changes while waiting for a backend retry prevent subsequent requests and publication',async()=>{
 const network={wifi:{ssid:'Synthetic first'}};let failed=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,network,respond:({options,requests})=>{
  if(options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor)){
   failed=true;network.wifi.ssid='Synthetic second';return {status:502};
  }
 }});
 assert(failed);assert.equal(r.writes.length,0);assert.match(r.output.content,/网络变化/);
});

test('adapter persists reserve progress and publishes ten only after on-demand supplementation',async()=>{
 const seen=[];
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({options})=>{
  if(!options.url.startsWith('https://www.youtube.com/premium?'))return;
  const d=options['policy-descriptor'];if(!seen.includes(d))seen.push(d);
  if(seen.indexOf(d)>=7&&seen.indexOf(d)<24)return {status:200,data:premiumPage({unavailable:true})};
 }});
 const s=JSON.parse(r.store['CFEdgeRank_example.net']);
 assert.equal(r.writes.length,1);assert(s.result.verified);assert.equal(s.result.supplement.added,3);
 assert.equal(s.result.premium.verified,10);assert.equal(seen.length,27);
 assert(r.states.some(x=>x.value.stage==='后备 Premium 与稳定性检查'&&x.value.supplement.examined===3));
 assert(r.states.some(x=>x.value.stage==='后备节点速度复测'));
 assert(r.logs.some(x=>x.includes('补入 3')));
});

test('login transport failure retries through current rules while every measurement keeps its explicit node',async()=>{
 const key='CFEdgeRank_example.net',sharedStore={};
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {sharedStore,fastTimers:true,respond:({options})=>{
  if(options.url.endsWith('/login')&&options.policy==='DIRECT')return {error:'request timed out'};
 }});
 const logins=r.requests.filter(x=>x.url.endsWith('/login'));
 assert.deepEqual(logins.map(x=>x.policy),['DIRECT',undefined]);
 assert(r.requests.filter(x=>x.url.startsWith('https://example.net/')&&!x.url.endsWith('/login')).every(x=>x.policy===undefined&&!x.descriptor));
 assert(r.requests.filter(x=>/cf_rank_light=|cf_rank=|cf_rank_premium=/.test(x.url)).every(x=>x.descriptor&&x.policy===undefined));
 assert.equal(r.writes.length,1);assert(JSON.parse(r.store[key]).result.verified);
 assert.equal(JSON.parse(r.store[key]).backendRoute,'rules');assert(r.states.some(x=>x.value.backendRetry&&x.value.backendRetry.includes('按现有规则')));
 assert(!JSON.stringify([r.logs,r.store]).includes('local-secret'));
 const next=await run('start|example.net|lite|40|local-secret','button',{}, {sharedStore});
 assert(next.requests.filter(x=>x.url.startsWith('https://example.net/')).every(x=>x.policy==='DIRECT'));
 assert.equal(JSON.parse(next.store[key]).backendRoute,'direct');
});
test('both backend paths failing stop before measurement after three total login attempts',async()=>{
 const key='CFEdgeRank_example.net',lastSuccess={at:Date.now()-3600000,count:10,bytes:100,mode:'lite'};
 const r=await run('start|example.net|lite|40|local-secret','button',{[key]:JSON.stringify({lastSuccess})},{fastTimers:true,respond:({options})=>{
  if(options.url.endsWith('/login'))return {status:0};
 }});
 assert.deepEqual(r.requests.filter(x=>x.url.endsWith('/login')).map(x=>x.policy),['DIRECT',undefined,undefined]);
 assert(!r.requests.some(x=>x.descriptor));assert.equal(r.writes.length,0);
 const saved=JSON.parse(r.store[key]);assert.equal(saved.failureStage,'正在登录后台');assert.equal(saved.bytes,0);
 assert.deepEqual(saved.lastSuccess,lastSuccess);assert.match(saved.message,/未收到响应.*3 次.*按现有规则/);
});
test('transport failure during final backend read switches route without restarting speed tests',async()=>{
 let failed=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,requests})=>{
  if(!failed&&options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor)){failed=true;return {error:'connection reset'};}
 }});
 assert(failed);assert.equal(r.writes.length,1);assert(JSON.parse(r.store['CFEdgeRank_example.net']).result.verified);
 assert.equal(r.requests.filter(x=>x.url.includes('cf_rank_light=')).length,2560);
 assert.equal(r.requests.filter(x=>x.url.includes('cf_rank_premium=')).length,58);
 assert(r.requests.filter(x=>x.method==='POST'&&x.url.includes('/admin/ADD.txt')).every(x=>x.policy===undefined));
});
test('HTTP rejection or bad credentials never switch routes to bypass a backend response',async()=>{
 for(const response of [{status:403},{status:200,data:'wrong password page'}]) {
  const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({options})=>options.url.endsWith('/login')?response:null});
  const logins=r.requests.filter(x=>x.url.endsWith('/login'));assert.equal(logins.length,1);assert.equal(logins[0].policy,'DIRECT');
  assert(!r.requests.some(x=>x.descriptor));assert.equal(r.writes.length,0);
  assert(!r.logs.some(x=>x.includes('后续管理请求')));
 }
});
test('network change on failed login prevents fallback requests on the new network',async()=>{
 const network={wifi:{ssid:'Synthetic first'}};
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {network,fastTimers:true,respond:({options})=>{
  if(options.url.endsWith('/login')){network.wifi.ssid='Synthetic second';return {error:'timeout'};}
 }});
 assert.equal(r.requests.filter(x=>x.url.endsWith('/login')).length,1);assert.equal(r.writes.length,0);
 assert.match(r.output.content,/网络变化/);
});
test('read-only subscription verification can use fallback without editing local configuration or backend',async()=>{
 const r=await run('verify|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options})=>{
  if(options.url.endsWith('/login')&&options.policy==='DIRECT')return {error:'timeout'};
 }});
 assert.equal(r.requests.filter(x=>x.url.endsWith('/login')).length,2);
 assert(r.logs.some(x=>x.includes('订阅核对通过')));assert.equal(r.writes.length,0);assert.equal(r.states.length,0);
});

function fixedClock(){let value=1700000000000;return {now:()=>value,advance:ms=>{value+=ms;}};}
test('adapter coalesces ordinary progress while preserving phase checkpoints and measuring storage work',async t=>{
 const clock=fixedClock();
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,storageCost:{read:1,write:2}});
 const s=JSON.parse(r.store['CFEdgeRank_example.net']),d=s.storageDiagnostics;
 assert(s.result.verified);assert.equal(r.writes.length,1);
 assert(d.coalescedProgress>1200);assert(d.progressUpdates>1280);
 assert(r.storageOps.reads<r.requests.length*5,'request guards must not repeatedly parse the same synchronous state');
 assert(r.storageOps.writes<100,'ordinary candidate completion must not persist every progress update');
 assert.equal(d.writes,r.storageOps.writes);assert(d.reads<=r.storageOps.reads);
 assert.equal(d.readMs,d.reads);assert.equal(d.writeMs,2*(d.writes-1));
 assert(r.states.some(x=>x.value.stage==='低流量连通与延迟初筛'&&x.value.done===0));
 assert(r.states.some(x=>x.value.stage==='低流量连通与延迟初筛'&&x.value.done===1280));
 assert(r.states.some(x=>x.value.stage==='发布前核对'));
 assert(r.states.some(x=>x.value.stage==='保存与订阅验证'));
 assert(r.logs.some(x=>x.includes('本机状态：读取')&&x.includes('合并进度')));
 assert(r.logs.some(x=>x.includes('下载复测：省去第二遍')));
 t.diagnostic(JSON.stringify({syntheticRequests:r.requests.length,stateReads:r.storageOps.reads,stateWrites:r.storageOps.writes,coalescedProgress:d.coalescedProgress}));
});
test('official candidate refresh duration is included in the persisted completion timings',async()=>{
 const clock=fixedClock(),initial=clock.now();let liveStartedAt;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,onRequest:({options})=>{
  if(options.url==='https://www.cloudflare.com/ips-v4')clock.advance(2500);
 },onWrite:({key,value})=>{
  if(key==='CFEdgeRank_example.net'&&value.stage==='低流量连通与延迟初筛')liveStartedAt=value.startedAt;
 }});
 const s=JSON.parse(r.store['CFEdgeRank_example.net']);
 assert(s.result.verified);assert.equal(s.result.stageTimings['更新候选池'],2500);
 assert.equal(liveStartedAt,initial);assert.equal(s.result.startedAt,initial+2500);
 assert(s.lastSuccess.elapsedMs>=2500);assert(r.logs.some(x=>x.includes('更新候选池 3秒')));
 assert(r.logs.some(x=>x.includes('本轮总耗时：2秒')));
});
test('heartbeat flush uses the newest coalesced progress instead of writing back an older checkpoint',async()=>{
 const clock=fixedClock(),initial=clock.now();let light=0;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,onRequest:({options})=>{
  if(options.url.includes('cf_rank_light=')&&++light===131)clock.advance(1100);
 }});
 const first=r.states.find(x=>x.key==='CFEdgeRank_example.net'&&x.value.updatedAt>=initial+1100);
 assert(first);assert.equal(first.value.stage,'低流量连通与延迟初筛');
 assert(first.value.done>0&&first.value.done<1280,'heartbeat must retain pending candidate completions');
 assert(JSON.parse(r.store['CFEdgeRank_example.net']).result.verified);
});
test('cancellation during coalesced progress is flushed immediately and never overwritten by heartbeat or failure handling',async()=>{
 const key='CFEdgeRank_example.net',clock=fixedClock();let light=0,cancelAt=-1;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,onRequest:({options,store})=>{
  if(options.url.includes('cf_rank_light=')&&++light===131){
   clock.advance(1100);store[key]=JSON.stringify({...JSON.parse(store[key]),cancelRequested:true});cancelAt=clock.now();
  }
 }});
 const s=JSON.parse(r.store[key]);assert.equal(r.writes.length,0);assert.equal(s.cancelRequested,true);
 assert.equal(s.failureStage,'低流量连通与延迟初筛');assert(s.done>0);assert.match(s.message,/取消/);
 const later=r.states.filter(x=>x.key===key&&x.value.updatedAt>=cancelAt);
 assert(later.length);assert(later.every(x=>x.value.cancelRequested===true));
});
test('a network switch during coalesced progress keeps the latest failure context without publishing',async()=>{
 const clock=fixedClock(),network={wifi:{ssid:'Synthetic first'}};let light=0;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,network,onRequest:({options})=>{
  if(options.url.includes('cf_rank_light=')&&++light===131)network.wifi.ssid='Synthetic second';
 }});
 const s=JSON.parse(r.store['CFEdgeRank_example.net']);assert.equal(r.writes.length,0);assert(s.done>0);
 assert.equal(s.failureStage,'低流量连通与延迟初筛');assert.match(s.message,/网络变化/);
});
test('superseding ownership at the publication checkpoint prevents buffered progress from reviving the old run',async()=>{
 const key='CFEdgeRank_example.net',clock=fixedClock();
 const replacement=JSON.stringify({running:true,ownerId:'replacement-owner',updatedAt:clock.now(),stage:'准备'});let replaced=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {clock,onWrite:({key:k,value,store})=>{
  if(k===key&&value.stage==='发布前核对'&&!replaced){replaced=true;store[key]=replacement;}
 }});
 assert(replaced);assert.equal(r.writes.length,0);assert.equal(r.store[key],replacement);
});
test('cancel received after saving starts remains recorded while subscription reconciliation completes',async()=>{
 const key='CFEdgeRank_example.net';let cancelled=false;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {onRequest:({method,options,store})=>{
  if(method==='POST'&&options.url.includes('/admin/ADD.txt')){cancelled=true;store[key]=JSON.stringify({...JSON.parse(store[key]),cancelRequested:true});}
 }});
 const s=JSON.parse(r.store[key]);assert(cancelled);assert.equal(r.writes.length,1);assert(s.result.verified);
 assert.equal(s.cancelRequested,true);assert.equal(s.running,false);
 assert(r.requests.some(x=>x.url.includes('&surge')));
});

test('failed-run notification copies its complete saved summary while the visible body stays short',async()=>{
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,requests})=>{
  if(options.url.includes('/admin/config.json')&&requests.some(x=>x.descriptor))return {error:'timeout'};
 }});
 const s=JSON.parse(r.store['CFEdgeRank_example.net']),n=r.notifications.at(-1);
 assert.equal(s.stage,'未完成');assert.equal(n.options.action,'clipboard');
 assert.match(n.options.text,/本轮总耗时：/);assert.match(n.options.text,/各阶段耗时：/);
 assert.match(n.options.text,/停止阶段：发布前核对/);assert.match(n.options.text,/读取后台配置失败/);
 assert.equal(n.body,s.message);assert(!n.body.includes('各阶段耗时'));assert(n.options.text.length>n.body.length);
 assert(!r.output.content.includes('各阶段耗时'));assert.equal(r.writes.length,0);
});
test('final Premium timeout diagnostics survive failed recovery and are copied without raw private data',async()=>{
 const key='CFEdgeRank_example.net';let target,finalCalls=0;
 const privateURL='https://private.example/credential?token='+('f'.repeat(32));
 const raw='timeout '+privateURL+' local-secret 11111111-1111-4111-8111-111111111111';
 const html='<html>private-premium-response</html>';
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,store})=>{
  if(!options.url.startsWith('https://www.youtube.com/premium?')||JSON.parse(store[key]).stage!=='出口与 Premium 最终复核')return;
  if(!target)target=options['policy-descriptor'];
  if(options['policy-descriptor']===target){finalCalls++;return {error:raw,data:html};}
 }});
 const s=JSON.parse(r.store[key]),n=r.notifications.at(-1);
 assert.equal(r.writes.length,0);assert.equal(finalCalls,2);
 assert.equal(s.premium.recoveryAttempts,1);assert.equal(s.premium.recovered,0);
 assert.equal(s.premiumFinalFailures.length,2);assert.equal(s.premiumFinalFailures[0].reason,'network_timeout');
 assert.equal(s.premiumFinalFailures[1].attempt,'recovery');
 assert.match(n.options.text,/停止阶段：出口与 Premium 最终复核/);
 assert.match(n.options.text,/Premium 恢复：尝试 1 个 · 恢复 0 个/);
 assert.match(n.options.text,/Premium 最终检测：候选 \d+ · 发布前复核 \/ 首次 · 请求超时/);
 assert.match(n.options.text,/第 3 检/);assert.match(n.options.text,/第 1 检/);
 assert.match(n.options.text,/发布前复核 \/ 恢复复测 · 请求超时/);
 assert.match(n.options.text,/恢复三检失败/);assert(!n.body.includes('Premium 最终检测：'));
 const exposed=JSON.stringify([r.logs,r.store,r.notifications,r.output]);
 for(const secret of [privateURL,html,'private-premium-response','local-secret','f'.repeat(32),'11111111-1111-4111-8111-111111111111'])assert(!exposed.includes(secret));
 assert(!/https?:\/\//.test(n.options.text));
});
test('final HTTP rejection has a safe status diagnostic and never attempts transport recovery',async()=>{
 const key='CFEdgeRank_example.net';let target,finalCalls=0;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {respond:({options,store})=>{
  if(!options.url.startsWith('https://www.youtube.com/premium?')||JSON.parse(store[key]).stage!=='出口与 Premium 最终复核')return;
  if(!target)target=options['policy-descriptor'];
  if(options['policy-descriptor']===target){finalCalls++;return {status:403,data:'<html>private-rejection-body</html>'};}
 }});
 const s=JSON.parse(r.store[key]),n=r.notifications.at(-1);
 assert.equal(finalCalls,1);assert.equal(r.writes.length,0);assert.equal(s.premium.recoveryAttempts,0);
 assert.equal(s.premiumFinalFailures[0].reason,'http');assert.equal(s.premiumFinalFailures[0].httpStatus,403);
 assert.match(n.options.text,/HTTP 403/);assert(!JSON.stringify([r.store,r.notifications,r.logs]).includes('private-rejection-body'));
});
test('a recovered final transport failure remains visible in the successful clipboard summary',async()=>{
 const key='CFEdgeRank_example.net';let target,finalCalls=0;
 const r=await run('start|example.net|lite|40|local-secret','button',{}, {fastTimers:true,respond:({options,store})=>{
  if(!options.url.startsWith('https://www.youtube.com/premium?')||JSON.parse(store[key]).stage!=='出口与 Premium 最终复核')return;
  if(!target)target=options['policy-descriptor'];
  if(options['policy-descriptor']===target&&++finalCalls===1)return {error:'connection reset with private information'};
 }});
 const s=JSON.parse(r.store[key]),n=r.notifications.at(-1);
 assert.equal(finalCalls,4);assert.equal(r.writes.length,1);assert(s.result.verified);
 assert.equal(s.result.premium.recoveryAttempts,1);assert.equal(s.result.premium.recovered,1);
 assert.equal(s.result.premiumFinalFailures[0].recovered,true);
 assert.match(n.options.text,/Premium 恢复：尝试 1 个 · 恢复 1 个/);assert.match(n.options.text,/已恢复/);
 assert(!JSON.stringify([r.store,r.logs,r.notifications]).includes('private information'));
});
test('older failure records remain readable without new diagnostic fields',async()=>{
 const key='CFEdgeRank_example.net',now=Date.now();
 const old={stage:'未完成',failureStage:'出口与 Premium 最终复核',startedAt:now-61000,updatedAt:now,running:false,bytes:100,
  premium:{passed:10,verified:8,bytes:200,unavailable:0,unknown:0,inconsistent:0},message:'检测未通过'};
 const r=await run('status|example.net|lite|40|','button',{[key]:JSON.stringify(old)});
 assert.equal(r.requests.length,0);assert.equal(r.notifications.length,0);
 const text=r.logs.join('\n');assert.match(text,/本轮总耗时：1分01秒/);assert.match(text,/停止阶段：出口与 Premium 最终复核/);
 assert(!text.includes('undefined'));assert(!text.includes('NaN'));assert(!text.includes('Premium 恢复：'));
});
test('diagnostic formatter allowlists fields and never echoes unknown reason strings or endpoint data',async()=>{
 const key='CFEdgeRank_example.net',privateData='https://private.example/local-secret';
 const state={stage:'未完成',message:'检测未通过',premiumFinalFailures:[{candidate:1,phase:'final',attempt:'initial',reason:privateData,
  httpStatus:privateData,networkError:privateData,regions:['US',privateData],oldestAgeMs:privateData,endpoint:privateData,headers:privateData,html:privateData}]};
 const r=await run('status|example.net|lite|40|','button',{[key]:JSON.stringify(state)});
 const text=JSON.stringify([r.logs,r.output]);assert.match(text,/原因未确认/);assert.match(text,/地区 US/);assert(!text.includes(privateData));
 assert.equal(r.requests.length,0);
});
