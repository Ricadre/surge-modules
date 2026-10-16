(async function () {
'use strict';
const core = CFRankCore;
const ui = CFPanelUI;
const poolSource=CFPoolSource;
let poolInfo=null;
let opts, stateKey, finished=false, ownsRun=false, ownerId;
const started=Date.now();
const localNetwork=typeof $network==='object'?$network:{};
const network=ui.networkInfo(localNetwork),networkLabel=ui.networkText(network);
const UA='CF-Edge-AutoRank/0.1.14';
console.log(UA+' · '+(typeof $trigger==='string'?$trigger:'manual'));
function read(){try{return JSON.parse($persistentStore.read(stateKey)||'{}');}catch(_){return {};}}
function write(value){if(!$persistentStore.write(JSON.stringify(value),stateKey))throw new Error('本机状态存储失败，已停止');}
function isOwner(){const s=read();return ownsRun&&s.ownerId===ownerId&&s.running===true;}
function requireOwner(){if(ownsRun&&!isOwner())throw new Error('本轮已停止或被新任务替代');}
function touch(){
  if(!isOwner())return;
  const s=read();if(Date.now()-(s.updatedAt||0)>=1000)write({...s,updatedAt:Date.now()});
}
function done(title,content,error,notify) {
  if(finished)return;finished=true;
  console.log(title+'\n'+content);
  const isPanel=typeof $input==='object'&&$input&&$input.purpose==='panel';
  const state=stateKey?read():{};
  const panel=ui.view(opts&&opts.action==='status'?'status':'main',state,Date.now(),opts&&opts.mode,error?content:null);
  if(notify&&typeof $notification!=='undefined')$notification.post(title,networkLabel,error||opts&&['rename','verify'].includes(opts.action)?content:panel.content+(state.stage==='完成'?'\n请刷新原 CF 订阅':''),{sound:false,action:'clipboard',text:title+'\n'+content});
  $done(isPanel?panel:{title,content,icon:'cloud.fill','icon-color':error?'#E05252':'#F48120'});
}
function statusText(s){
  if(!s.stage)return '尚未运行。先在模块参数填写后台密码，再手动点击开始。';
  const lines=[s.stage+(s.total?' '+(s.done||0)+'/'+s.total:''), '已接收下载正文约 '+((s.bytes||0)/1000000).toFixed(1)+' MB'];
  const premium=s.premium||s.result&&s.result.premium;
  if(premium)lines.push('Premium：通过 '+premium.passed+'/10 · 发布前复核 '+premium.verified+'/10 · 检测正文约 '+(premium.bytes/1000000).toFixed(1)+' MB');
  if(premium)lines.push('Premium 未入选：地区不可用 '+premium.unavailable+' · 未确认 '+premium.unknown+' · 地区不一致 '+premium.inconsistent);
  const supplement=s.supplement||s.result&&s.result.supplement;
  if(supplement&&supplement.examined)lines.push('后备补选：已检测 '+supplement.examined+'/'+supplement.available+' · 复测 '+supplement.refined+'/'+supplement.limit+' · 补入 '+supplement.added+' · 复测未通过 '+supplement.failedRefine);
  if(premium&&premium.refreshed)lines.push('已更新 Premium 检测记录：'+premium.refreshed+'/10');
  if(s.updatedAt)lines.push('更新：'+new Date(s.updatedAt).toLocaleString());
  if(s.network)lines.push('本轮网络：'+ui.networkText(s.network));
  if(s.poolInfo)lines.push('候选池：'+poolSource.label(s.poolInfo)+(s.poolInfo.fetchedAt?' · 获取于 '+ui.dateText(s.poolInfo.fetchedAt):''));
  if(s.failureStage)lines.push('停止阶段：'+s.failureStage);
  if(s.message)lines.push(s.message);
  if(s.result)lines.push(...s.result.selected.map((x,i)=>String(i+1).padStart(2,'0')+' '+x.key+' · '+x.score.toFixed(2)+' Mbps'+(x.premium?' · Premium '+x.premium.region:'')));
  return lines.join('\n');
}
function request(options,method) {
  return new Promise((resolve,reject)=>{
    requireOwner();touch();
    const begin=Date.now();
    $httpClient[method.toLowerCase()](options,(error,response,data)=>{
      try { requireOwner();touch(); } catch (e) {reject(e);return;}
      const safeError=error?(/timeout|timed out|超时/i.test(String(error))?'timeout':'request failed'):null;
      const bytes=data&&typeof data.byteLength==='number'?data.byteLength:data&&Array.isArray(data)?data.length:0;
      resolve({error:safeError,status:response?Number(response.status):0,headers:response&&response.headers||{},data,bytes,ms:Math.max(1,Date.now()-begin)});
    });
  });
}
function decodeJSON(text,label){try{return JSON.parse(text);}catch(_){throw new Error(label+'返回格式异常');}}
try {
  opts=core.settings(typeof $argument==='string'?$argument:'');
  stateKey='CFEdgeRank_'+opts.host;
  if(opts.action==='status'){const s=read();done('Cloudflare 测速进度',statusText(s),false,false);return;}
  if(opts.action==='cancel'){const s=read();if(s.running){s.cancelRequested=true;s.message='已请求取消；正在保存时将先完成核对或恢复';write(s);}done('CF 取消请求',s.running?'将在当前请求结束后停止。':'当前没有进行中的测试。',false,false);return;}
  if(typeof $trigger==='string'&&$trigger==='auto-interval'){const s=read();done('Cloudflare 一键优选',statusText(s),false,false);return;}
  if(!opts.password)throw new Error('请在模块参数 admin_password 填写后台登录密码；不要发送到聊天或提交到仓库');
  const previous=read();
  if(previous.running&&Date.now()-previous.updatedAt<ui.RESTART_MS){done('Cloudflare 正在优选',statusText(previous),false,false);return;}
  const history=ui.lastSuccess(previous);
  if(opts.action==='start'||opts.action==='rename'){
    ownerId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);ownsRun=true;
    write({running:true,ownerId,startedAt:started,updatedAt:started,stage:'正在登录后台',mode:opts.mode,network,lastSuccess:history,bytes:0,cancelRequested:false});
  }
  const origin='https://'+opts.host;
  const networkKey=()=>{const n=typeof $network==='object'?$network:localNetwork;return JSON.stringify([n.wifi&&n.wifi.ssid,n.v4&&n.v4.primaryInterface,n.v4&&n.v4.primaryAddress]);};
  const controlNetwork=networkKey();
  function controlGuard(){requireOwner();if(networkKey()!==controlNetwork)throw new Error('检测到网络变化，本轮结果已丢弃');}
  const retryable=r=>!!r.error||r.status===408||r.status===429||r.status>=500&&r.status<=599;
  function controlError(label,r,attempt,method){
    const reason=r.error==='timeout'?'请求超时':r.error?'连接失败':r.status?'HTTP '+r.status:'未收到响应';
    const error=new Error(label+'失败（'+reason+'，已尝试 '+attempt+' 次）');
    // Store only allowlisted labels and codes, never the URL, body or raw error.
    error.controlFailure={label,status:r.status||0,reason,attempt,uncertain:method==='POST'&&retryable(r)};
    return error;
  }
  async function retryWait(label,nextAttempt){
    controlGuard();
    const note=label+' · 重试 '+nextAttempt+'/3';
    console.log(note);
    if(isOwner())write({...read(),backendRetry:note,updatedAt:Date.now()});
    await new Promise(resolve=>setTimeout(resolve,nextAttempt===2?1000:3000));
    controlGuard();
  }
  function clearRetry(){if(isOwner()&&read().backendRetry)write({...read(),backendRetry:null,updatedAt:Date.now()});}
  if(opts.action==='start') {
    const initialNetwork=networkKey();
    const guard=()=>{requireOwner();if(read().cancelRequested)throw new Error('已取消，未发布结果');if(networkKey()!==initialNetwork)throw new Error('检测到网络变化，本轮结果已丢弃');};
    let cached;try{cached=JSON.parse($persistentStore.read(stateKey+'_poolcache')||'null');}catch(_){}
    write({...read(),stage:'更新候选池',updatedAt:Date.now()});
    poolInfo=await poolSource.refresh({now:()=>Date.now(),guard,cached,
      fetch:url=>request({url,policy:'DIRECT',timeout:8,'auto-cookie':false,'auto-redirect':false,
        headers:{'User-Agent':UA,'Cache-Control':'no-cache',Accept:'text/plain, application/json'}},'GET'),
      save:cache=>{guard();return $persistentStore.write(JSON.stringify(cache),stateKey+'_poolcache');}
    },CF_RANK_OFFICIAL);
    guard();write({...read(),poolInfo,stage:'正在登录后台',updatedAt:Date.now()});
    console.log('候选池：'+poolSource.label(poolInfo)+' · '+poolInfo.addressCount+' 个 IPv4 地址');
    if(!poolInfo.source.startsWith('live-'))console.log('官方在线更新未成功，本轮使用'+poolSource.label(poolInfo));
    if(poolInfo.cacheSaved===false)console.log('本轮在线池已取得，但本机缓存保存失败');
  }
  async function control(method,path,body){
    if(!(/^\/admin\/(config\.json|ADD\.txt)$/.test(path)||/^\/sub\?token=[a-fA-F0-9]{32}&(b64|surge)$/.test(path)))throw new Error('拒绝未授权的后台路径');
    if(method==='POST'&&path!=='/admin/ADD.txt')throw new Error('本工具只允许保存自定义节点列表');
    const label=method==='POST'?'保存节点':path==='/admin/config.json'?'读取后台配置':path==='/admin/ADD.txt'?'读取节点列表':path.endsWith('&b64')?'读取原始订阅':'读取 Surge 订阅';
    const attempts=method==='GET'?3:1;let reauthenticated=false;
    for(let attempt=1;attempt<=attempts;attempt++){
      controlGuard();
      const url=origin+path+(path.includes('?')?'&':'?')+'cf_rank_read='+Date.now()+'-'+attempt;
      const r=await request({url,body,policy:'DIRECT',timeout:35,'auto-cookie':true,'auto-redirect':false,
        headers:{'User-Agent':UA,'Cache-Control':'no-cache','Content-Type':'text/plain;charset=utf-8'}},method);
      controlGuard();
      if(!r.error&&r.status===200){
        clearRetry();
        if(path==='/admin/config.json'||method==='POST'){
          try{return decodeJSON(r.data,label);}
          catch(error){if(method==='POST')error.controlFailure={label,uncertain:true};throw error;}
        }
        if(typeof r.data!=='string')throw new Error(label+'返回的数据格式不正确');
        return r.data;
      }
      if(method==='GET'&&path.startsWith('/admin/')&&[302,401].includes(r.status)&&!r.error&&!reauthenticated&&attempt<attempts){
        reauthenticated=true;console.log(label+' · 重新登录一次');
        await login(opts.host,opts.password);continue;
      }
      if(attempt<attempts&&retryable(r)){await retryWait(label,attempt+1);continue;}
      throw controlError(label,r,attempt,method);
    }
  }
  async function login(host,password){
    for(let attempt=1;attempt<=3;attempt++){
      controlGuard();
      const r=await request({url:origin+'/login',body:'password='+encodeURIComponent(password),policy:'DIRECT',timeout:20,
        'auto-cookie':true,'auto-redirect':false,headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'}},'POST');
      controlGuard();
      if(!r.error&&[200,302].includes(r.status)){
        if(r.status===200){let data;try{data=JSON.parse(r.data);}catch(_){throw new Error('后台密码未被接受，请在模块参数检查');}if(!data.success)throw new Error('后台登录未成功');}
        clearRetry();return;
      }
      if(attempt<3&&retryable(r)){await retryWait('登录后台',attempt+1);continue;}
      throw controlError('登录后台',r,attempt,'GET');
    }
  }
  if(opts.action==='verify') {
    await login(opts.host,opts.password);
    const cfg=core.configGuard(await control('GET','/admin/config.json'),opts.host);
    const list=await control('GET','/admin/ADD.txt'),allowed=core.includeCurrent(list,CF_RANK_POOLS.concat(CF_RANK_OFFICIAL));
    const entries=core.parseList(list,allowed);
    const raw=core.parseRaw(await control('GET','/sub?token='+cfg.token+'&b64'),cfg,allowed);
    const surge=core.parseSurge(await control('GET','/sub?token='+cfg.token+'&surge'),cfg,allowed);
    if(!core.sameNamedEntries(entries,raw)||!core.sameNamedEntries(entries,surge))throw new Error('后台与两种订阅的节点或名称尚未一致，可稍后复查');
    done('CF 订阅核对通过',entries.length+' 个入口与后台一致，可以刷新 Surge 订阅。',false,true);return;
  }
  let lastStage='', lastLogged=0;
  const env={
    id:()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10), now:()=>Date.now(), random:()=>Math.random(),
    networkKey,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    login,control,
    geoip:ip=>typeof $utils!=='undefined'&&typeof $utils.geoip==='function'?$utils.geoip(ip):'',
    probe:async spec=>request({url:spec.url,'policy-descriptor':spec.descriptor,timeout:spec.timeout,
      'binary-mode':!!spec.binary,'auto-cookie':false,'auto-redirect':false,headers:spec.headers},spec.method),
    cancelled:async()=>!isOwner()||!!read().cancelRequested,
    progress:async p=>{requireOwner();const old=read();write({...p,ownerId,network,poolInfo,lastSuccess:history,running:true,cancelRequested:!!old.cancelRequested});
      if(p.stage!==lastStage||p.done-lastLogged>=10||p.done===p.total){console.log(p.stage+' '+p.done+'/'+p.total+'，约 '+(p.bytes/1000000).toFixed(1)+' MB');lastStage=p.stage;lastLogged=p.done;}},
    backup:async value=>{requireOwner();if(!$persistentStore.write(JSON.stringify(value),stateKey+'_backup'))throw new Error('无法备份原列表，停止发布');}
  };
  if(opts.action==='rename') {
    const renamed=await core.renameOnly(env,opts,CF_RANK_POOLS);requireOwner();
    const known=renamed.selected.filter(e=>e.egress&&e.egress.country).length;
    const message='10 个名称已核对，'+known+' 个出口国家已识别，'+(10-known)+' 个未知以 🌐 标记。IP、端口和顺序未变。请刷新原订阅。';
    write({running:false,ownerId,startedAt:started,stage:'名称已核对',mode:opts.mode,network,lastSuccess:history,updatedAt:Date.now(),bytes:0,nameResult:renamed,message});
    done('Cloudflare 节点名称已核对',message,false,true);return;
  }
  const result=await core.execute(env,opts,CF_RANK_POOLS,poolInfo);
  requireOwner();
  const complete=result.selected.reduce((n,x)=>n+x.samples.filter(s=>!s.partial).length,0);
  const message=(result.changed?'前十已保存':'列表无变化')+'，Premium 10/10 检测通过，原始和 Surge 订阅均已核对。请刷新原订阅。\n本轮 '+result.candidateCount+' 个入口轻量初筛，'+result.reachable+' 个通过，'+result.downloadCandidateCount+' 个下载候选；'+complete+'/20 次复测为完整下载，其余为有效限时样本。\nPremium 仅表示检测时的地区可用性，不验证会员账号资格；仅代表当前网络和本轮候选。';
  const finishedAt=Date.now();
  const lastSuccess={at:finishedAt,network,mode:opts.mode,count:result.selected.length,bytes:result.bytes,premiumBytes:result.premium.bytes,premiumVerified:result.premium.verified,changed:result.changed,elapsedMs:finishedAt-started};
  write({running:false,ownerId,startedAt:started,stage:'完成',mode:opts.mode,network,poolInfo,lastSuccess,updatedAt:finishedAt,bytes:result.bytes,result,message});
  done('Cloudflare 优选完成 · '+(result.changed?'已更新':'无变化'),statusText(read()),false,true);
} catch(error) {
  const message=String(error.message||'未知错误');
  if(stateKey&&ownsRun&&!isOwner()){done('Cloudflare 旧任务已结束',statusText(read()),false,false);return;}
  if(stateKey&&ownsRun){const old=read();try{write({...old,running:false,stage:'未完成',failureStage:old.stage,backendRetry:null,updatedAt:Date.now(),message});}catch(_){}}
  done('Cloudflare 优选未完成',message,true,true);
}
})();
