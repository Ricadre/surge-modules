(async function () {
'use strict';
const core = CFRankCore;
const ui = CFPanelUI;
const poolSource=CFPoolSource;
let poolInfo=null,backendRoute='direct';
let opts, stateKey, finished=false, ownsRun=false, ownerId;
let latestProgress=null,lastStateWriteAt=0;
const preludeTimings={};
const storageDiagnostics={reads:0,writes:0,readMs:0,writeMs:0,progressUpdates:0,coalescedProgress:0};
const PROGRESS_WRITE_MS=750;
const started=Date.now();
const localNetwork=typeof $network==='object'?$network:{};
const network=ui.networkInfo(localNetwork),networkLabel=ui.networkText(network);
const UA='CF-Edge-AutoRank/0.1.22';
console.log(UA+' · '+(typeof $trigger==='string'?$trigger:'manual'));
function read(key=stateKey){
  const begin=Date.now();storageDiagnostics.reads++;
  try{return JSON.parse($persistentStore.read(key)||'{}');}catch(_){return {};}
  finally{storageDiagnostics.readMs+=Math.max(0,Date.now()-begin);}
}
function write(value,key=stateKey){
  const begin=Date.now();storageDiagnostics.writes++;
  // The saved timing excludes this write itself, avoiding another diagnostic write.
  const record=key===stateKey&&ownsRun&&value.ownerId===ownerId?{...value,storageDiagnostics:{...storageDiagnostics}}:value;
  try{if(!$persistentStore.write(JSON.stringify(record),key))throw new Error('本机状态存储失败，已停止');}
  finally{storageDiagnostics.writeMs+=Math.max(0,Date.now()-begin);}
  if(key===stateKey)lastStateWriteAt=Date.now();
}
function isOwner(s){return ownsRun&&s&&s.ownerId===ownerId&&s.running===true;}
// A supplied state is used only within the same synchronous call; never across await.
function requireOwner(s=ownsRun?read():null){if(ownsRun&&!isOwner(s))throw new Error('本轮已停止或被新任务替代');return s;}
function ownedWrite(patch={},s=requireOwner()){
  requireOwner(s);
  if(!ownsRun)return;
  write({...s,...latestProgress,backendRoute,...patch,cancelRequested:!!s.cancelRequested});
}
function touch(s){
  if(ownsRun&&Date.now()-(s.updatedAt||0)>=1000)ownedWrite({updatedAt:Date.now()},s);
}
function done(title,content,error,notify) {
  if(finished)return;finished=true;
  const isPanel=typeof $input==='object'&&$input&&$input.purpose==='panel';
  const state=stateKey?read():{};
  // A failed run keeps a short visible message, but copying its notification
  // includes the saved failure context and timings, just like a successful run.
  const detail=error&&ownsRun&&state.ownerId===ownerId&&state.stage==='未完成'?statusText(state):content;
  console.log(title+'\n'+detail);
  const panel=ui.view(opts&&opts.action==='status'?'status':'main',state,Date.now(),opts&&opts.mode,error?content:null);
  if(notify&&typeof $notification!=='undefined')$notification.post(title,networkLabel,error||opts&&['rename','verify'].includes(opts.action)?content:panel.content+(state.stage==='完成'?'\n请刷新原 CF 订阅':''),{sound:false,action:'clipboard',text:title+'\n'+detail});
  $done(isPanel?panel:{title,content,icon:'cloud.fill','icon-color':error?'#E05252':'#F48120'});
}
function premiumFailureText(value){
  if(!value||typeof value!=='object')return null;
  const reasons={network_timeout:'请求超时',network:'连接失败',http:'HTTP 响应异常',region_unavailable:'地区不可用',country_unverified:'YouTube 无法验证出口国家',challenge:'出现验证页面',body:'正文不完整或异常',page_format:'页面格式未确认',region_unknown:'地区未确认',no_full_premium_offer:'未确认完整 Premium 购买入口',region_changed:'地区发生变化',expired:'检测记录过期',future_time:'检测时间晚于当前时间',invalid_time:'检测时间无效',incomplete:'检测记录不完整'};
  const candidate=Number.isInteger(value.candidate)&&value.candidate>=1&&value.candidate<=10?value.candidate:'?';
  const phase=value.phase==='refresh'?'更新检测':value.phase==='final'?'发布前复核':'检测';
  const attempt=value.attempt==='recovery'?'恢复复测':'首次';
  const reason=Object.prototype.hasOwnProperty.call(reasons,value.reason)?reasons[value.reason]:'原因未确认';
  const lines=['候选 '+candidate+' · '+phase+' / '+attempt+' · '+reason];
  if(Number.isInteger(value.index)&&value.index>=0&&value.index<=2)lines.push('第 '+(value.index+1)+' 检');
  if(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)lines.push('HTTP '+value.httpStatus);
  if(value.networkError==='timeout')lines.push('网络超时');else if(value.networkError==='connection')lines.push('连接错误');
  const regions=Array.isArray(value.regions)?value.regions.filter(x=>typeof x==='string'&&/^[A-Z]{2}$/.test(x)).slice(0,3):[];
  if(regions.length)lines.push('地区 '+regions.join(' → '));
  if(Number.isFinite(value.oldestAgeMs)&&value.oldestAgeMs>=0)lines.push('最早记录 '+Math.round(value.oldestAgeMs/1000)+'秒前');
  if(value.recovered===true)lines.push('已恢复');else if(value.recoveryAttempted===true)lines.push('已尝试恢复');
  if(value.discarded===true)lines.push('本轮已淘汰');
  return lines.join(' · ');
}
function statusText(s){
  if(!s.stage)return '尚未运行。先在模块参数填写后台密码，再手动点击开始。';
  const lines=[s.stage+(s.total?' '+(s.done||0)+'/'+s.total:''), '已接收下载正文约 '+((s.bytes||0)/1000000).toFixed(1)+' MB'];
  if(['lite','full'].includes(s.mode))lines.push('本轮档位：'+(s.mode==='full'?'完整':'省流')+' · '+core.scanCount(s.mode)+' 个轻筛入口 · 每次复测最多 '+core.MODES[s.mode].sampleBytes/1000000+' MB / 8 秒'+(s.mode==='full'&&(s.downloadDiagnostics||s.result&&s.result.downloadDiagnostics)?'（2 MB 分段）':''));
  if(s.startedAt)lines.push('本轮总耗时：'+ui.duration(Math.max(0,(s.running?Date.now():s.updatedAt||Date.now())-s.startedAt)));
  const premium=s.premium||s.result&&s.result.premium;
  if(premium&&premium.preflight){
    const p=premium.preflight;
    lines.push('下载前 Premium 首检：已测 '+p.tested+'/'+p.total+' · 合格 '+p.passed+' · 地区不可用 '+p.unavailable+' · 未确认 '+p.unknown+' · 跳过下载 '+p.skippedDownloads+' 个');
    lines.push('入围 Premium 二检：复用新鲜首检 '+p.reused+' 个 · 首检过旧重新双检 '+p.refreshed+' 个');
  }
  if(premium&&premium.eligible!==undefined)lines.push('Premium 预检：'+premium.eligible+'/'+premium.tested+' 个通过');
  if(premium)lines.push('综合入选：'+premium.passed+'/10 · Premium 发布前复核 '+premium.verified+'/10 · 检测正文约 '+(premium.bytes/1000000).toFixed(1)+' MB');
  if(premium)lines.push('Premium 未入选：地区不可用 '+premium.unavailable+' · 未确认 '+premium.unknown+' · 地区不一致 '+premium.inconsistent);
  const stability=s.stability||s.result&&s.result.stability;
  if(stability)lines.push('稳定性检查：通过 '+stability.passed+'/'+stability.tested+' · 未通过 '+stability.failed);
  const downloads=s.downloadDiagnostics||s.result&&s.result.downloadDiagnostics;
  const reasons={timeout_empty:'超时且未返回正文',size_limit:'响应大小限制',network:'连接错误',http:'HTTP 状态异常',range:'Content-Range 不符',oversize:'正文超出请求范围',empty_body:'未返回二进制正文',too_small:'有效正文不足',truncated:'正文不完整',timing:'耗时无效',invalid:'响应无法确认'};
  if(downloads) {
    for(const phase of ['screen','retest']){
      const d=downloads[phase];if(!d||!d.samples)continue;
      lines.push((phase==='screen'?'下载初筛':'下载复测')+'样本：有效 '+d.valid+'/'+d.samples+' · 限时样本 '+d.partial+' · HTTP 请求 '+d.requests+' · 空正文超时 '+d.emptyTimeouts);
      const failures=Object.entries(d.failures||{}).filter(([key])=>Object.prototype.hasOwnProperty.call(reasons,key)).map(([key,count])=>reasons[key]+' '+Number(count));
      if(failures.length)lines.push('下载失败分类（'+(phase==='screen'?'初筛':'复测')+'）：'+failures.join(' · ')+'；HTTP '+Object.entries(d.http||{}).filter(([status])=>/^(0|[1-5]\d\d)$/.test(status)).map(([status,count])=>(status==='0'?'无响应':status)+' × '+Number(count)).join(' / '));
    }
    for(const e of (Array.isArray(downloads.examples)?downloads.examples:[]).slice(0,6)){
      if(!Object.prototype.hasOwnProperty.call(reasons,e.reason))continue;
      lines.push('下载失败示例：'+(e.phase==='retest'?'复测':'初筛')+' · '+reasons[e.reason]+' · HTTP '+(Number(e.status)||0)+' · 请求 '+Number(e.requestedBytes)+' B / 收到 '+Number(e.bytes)+' B · '+Math.round(Number(e.ms))+' ms');
    }
    if(downloads.retest&&downloads.retest.emptyTimeouts||downloads.screen&&downloads.screen.emptyTimeouts)lines.push('流量说明：超时未返回的正文无法计数；已接收正文统计不等于实际网络耗流。');
  }
  const supplement=s.supplement||s.result&&s.result.supplement;
  if(supplement&&supplement.examined)lines.push('后备补选：已检测 '+supplement.examined+'/'+supplement.available+' · 复测名额 '+supplement.refined+'/'+supplement.limit+' · 补入 '+supplement.added+' · 稳定性或下载未通过 '+supplement.failedRefine);
  const finalSelection=s.finalSelection||s.result&&s.result.finalSelection;
  if(finalSelection)lines.push('发布前补位：复核 '+finalSelection.examined+' 个 · 淘汰 '+finalSelection.rejected+' 个 · 补位检查 '+finalSelection.replacementChecks+' 个 · 已补入 '+finalSelection.replacements+' 个 · 补测第二次下载 '+finalSelection.resumedDownloads+' 次');
  if(premium&&premium.refreshed)lines.push('已更新 Premium 检测记录：'+premium.refreshed+' 个');
  if(premium&&Number.isInteger(premium.recoveryAttempts))lines.push('Premium 恢复：尝试 '+premium.recoveryAttempts+' 个 · 恢复 '+(Number.isInteger(premium.recovered)?premium.recovered:0)+' 个');
  const failures=s.premiumFinalFailures||s.result&&s.result.premiumFinalFailures;
  if(Array.isArray(failures))for(const failure of failures.slice(0,20)){const detail=premiumFailureText(failure);if(detail)lines.push('Premium 最终检测：'+detail);}
  const timings=s.result&&s.result.stageTimings||s.stageTimings;
  if(timings)lines.push('各阶段耗时：'+Object.entries(timings).filter(([,ms])=>ms>=1000).map(([stage,ms])=>stage+' '+Math.round(ms/1000)+'秒').join(' · '));
  const light=s.result&&s.result.lightScreen||s.lightScreen;
  if(light&&Number.isInteger(light.firstTested)){
    lines.push('轻量首检：覆盖 '+light.firstTested+'/'+light.firstTotal+' 个入口 · 首检合格 '+light.firstPassed+' 个 IP');
    lines.push('轻量二检：请求 '+light.secondRequests+' 次 · 已完成 '+light.secondTested+' 次 · 确认 '+light.secondPassed+' 个 IP 双检合格 · '+(light.selectionComplete?'省略 '+light.skippedSecond+' 次':'尚未完成，省略数量未结算'));
    lines.push('轻量请求：首检 '+light.firstRequests+' 次（含降载复检） · 二检 '+light.secondRequests+' 次');
  }
  if(light)lines.push('轻量检测：最高并发 '+light.maxConcurrency+' · 降载 '+light.backoffs+' 次 · 复核 '+light.rechecked+' 个');
  const refinement=s.result&&s.result.refinement||s.refinement;
  if(refinement)lines.push('下载复测：省去第二遍 '+refinement.savedSecondSamples+' 次（首遍无效 '+(refinement.skippedInvalidFirst+refinement.reserveSkippedInvalidFirst)+' · 已无法入选 '+refinement.skippedByBound+'）');
  const storage=s.storageDiagnostics;
  if(storage)lines.push('本机状态：读取 '+storage.reads+' 次 · 写入 '+storage.writes+' 次 · 合并进度 '+storage.coalescedProgress+' 次 · 累计约 '+(storage.readMs+storage.writeMs)+' 毫秒');
  if(s.backendRoute)lines.push('后台请求路径：'+(s.backendRoute==='rules'?'按现有 Surge 规则':'DIRECT'));
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
    touch(requireOwner());
    const begin=Date.now();
    $httpClient[method.toLowerCase()](options,(error,response,data)=>{
      try { touch(requireOwner()); } catch (e) {reject(e);return;}
      const safeError=error?(/timeout|timed out|超时/i.test(String(error))?'timeout':/body too large|response too large|maximum (?:response |body )?size|size limit|exceeds? (?:the )?(?:maximum|size|limit)/i.test(String(error))?'response size limit':'request failed'):null;
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
    write({running:true,ownerId,startedAt:started,updatedAt:started,stage:'正在登录后台',mode:opts.mode,network,backendRoute,lastSuccess:history,bytes:0,cancelRequested:false});
  }
  const origin='https://'+opts.host;
  const networkKey=()=>{const n=typeof $network==='object'?$network:localNetwork;return JSON.stringify([n.wifi&&n.wifi.ssid,n.v4&&n.v4.primaryInterface,n.v4&&n.v4.primaryAddress]);};
  const controlNetwork=networkKey();
  function controlGuard(){requireOwner();if(networkKey()!==controlNetwork)throw new Error('检测到网络变化，本轮结果已丢弃');}
  const retryable=r=>!!r.error||!r.status||r.status===408||r.status===429||r.status>=500&&r.status<=599;
  function controlError(label,r,attempt,method,route=backendRoute){
    const reason=r.error==='timeout'?'请求超时':r.error?'连接失败':r.status?'HTTP '+r.status:'未收到响应';
    const error=new Error(label+'失败（'+reason+'，已尝试 '+attempt+' 次；'+(route==='rules'?'按现有规则':'DIRECT')+'）');
    // Store only allowlisted labels and codes, never the URL, body or raw error.
    error.controlFailure={label,status:r.status||0,reason,attempt,route,uncertain:method==='POST'&&retryable(r)};
    return error;
  }
  function backendOptions(){return backendRoute==='direct'?{policy:'DIRECT'}:{};}
  function fallbackBackend(r){
    // Only transport failures change the management path. Never redirect a
    // speed/Premium probe or override the user's selected policies/settings.
    if(backendRoute!=='direct'||(!r.error&&r.status))return;
    controlGuard();backendRoute='rules';
    console.log('后台直连连接失败，后续管理请求按现有 Surge 规则；测速路径不变');
    if(ownsRun)ownedWrite({backendRoute,updatedAt:Date.now()});
  }
  async function retryWait(label,nextAttempt){
    controlGuard();
    const note=label+' · 重试 '+nextAttempt+'/3'+(backendRoute==='rules'?' · 按现有规则':'');
    console.log(note);
    if(ownsRun)ownedWrite({backendRetry:note,updatedAt:Date.now()});
    await new Promise(resolve=>setTimeout(resolve,nextAttempt===2?1000:3000));
    controlGuard();
  }
  function clearRetry(){const s=requireOwner();if(ownsRun&&s.backendRetry)ownedWrite({backendRetry:null,updatedAt:Date.now()},s);}
  if(opts.action==='start') {
    const initialNetwork=networkKey();
    const guard=()=>{const s=requireOwner();if(s.cancelRequested)throw new Error('已取消，未发布结果');if(networkKey()!==initialNetwork)throw new Error('检测到网络变化，本轮结果已丢弃');};
    const cached=read(stateKey+'_poolcache');
    ownedWrite({stage:'更新候选池',updatedAt:Date.now()});
    const poolStarted=Date.now();
    try {poolInfo=await poolSource.refresh({now:()=>Date.now(),guard,cached,
      fetch:url=>request({url,policy:'DIRECT',timeout:8,'auto-cookie':false,'auto-redirect':false,
        headers:{'User-Agent':UA,'Cache-Control':'no-cache',Accept:'text/plain, application/json'}},'GET'),
      save:cache=>{guard();try{write(cache,stateKey+'_poolcache');return true;}catch(_){return false;}}
    },CF_RANK_OFFICIAL);}finally{preludeTimings['更新候选池']=Math.max(0,Date.now()-poolStarted);}
    guard();ownedWrite({poolInfo,stage:'正在登录后台',stageTimings:{...preludeTimings},updatedAt:Date.now()});
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
      const route=backendRoute;
      const r=await request({url,body,...backendOptions(),timeout:35,'auto-cookie':true,'auto-redirect':false,
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
      if(attempt<attempts&&retryable(r)){fallbackBackend(r);await retryWait(label,attempt+1);continue;}
      // A save may have succeeded even if its response was lost. Select the
      // fallback for readback, but leave POST reconciliation to the core.
      if(method==='POST'&&retryable(r))fallbackBackend(r);
      throw controlError(label,r,attempt,method,route);
    }
  }
  async function login(host,password){
    for(let attempt=1;attempt<=3;attempt++){
      controlGuard();
      const route=backendRoute;
      const r=await request({url:origin+'/login',body:'password='+encodeURIComponent(password),...backendOptions(),timeout:20,
        'auto-cookie':true,'auto-redirect':false,headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'}},'POST');
      controlGuard();
      if(!r.error&&[200,302].includes(r.status)){
        if(r.status===200){let data;try{data=JSON.parse(r.data);}catch(_){throw new Error('后台密码未被接受，请在模块参数检查');}if(!data.success)throw new Error('后台登录未成功');}
        clearRetry();return;
      }
      if(attempt<3&&retryable(r)){fallbackBackend(r);await retryWait('登录后台',attempt+1);continue;}
      throw controlError('登录后台',r,attempt,'GET',route);
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
    cancelled:async()=>{const s=read();if(!isOwner(s))return true;if(s.cancelRequested)ownedWrite({updatedAt:Date.now()},s);return !!s.cancelRequested;},
    progress:async p=>{const old=requireOwner();storageDiagnostics.progressUpdates++;
      latestProgress={...p,startedAt:started,stageTimings:{...preludeTimings,...p.stageTimings},ownerId,network,poolInfo,backendRoute,lastSuccess:history,running:true};
      const diagnosticChanged=Array.isArray(p.premiumFinalFailures)&&p.premiumFinalFailures.length&&JSON.stringify(p.premiumFinalFailures)!==JSON.stringify(old.premiumFinalFailures);
      const checkpoint=p.stage!==old.stage||p.done===p.total||/发布前|保存|完成/.test(p.stage)||old.cancelRequested||diagnosticChanged;
      if(checkpoint||Date.now()-lastStateWriteAt>=PROGRESS_WRITE_MS)ownedWrite({},old);else storageDiagnostics.coalescedProgress++;
      if(p.stage!==lastStage||p.done-lastLogged>=10||p.done===p.total){console.log(p.stage+' '+p.done+'/'+p.total+'，约 '+(p.bytes/1000000).toFixed(1)+' MB');lastStage=p.stage;lastLogged=p.done;}},
    backup:async value=>{requireOwner();try{write(value,stateKey+'_backup');}catch(_){throw new Error('无法备份原列表，停止发布');}}
  };
  if(opts.action==='rename') {
    const renamed=await core.renameOnly(env,opts,CF_RANK_POOLS);requireOwner();
    const known=renamed.selected.filter(e=>e.egress&&e.egress.country).length;
    const message='10 个名称已核对，'+known+' 个出口国家已识别，'+(10-known)+' 个未知以 🌐 标记。IP、端口和顺序未变。请刷新原订阅。';
    ownedWrite({running:false,ownerId,startedAt:started,stage:'名称已核对',mode:opts.mode,network,backendRoute,lastSuccess:history,updatedAt:Date.now(),bytes:0,nameResult:renamed,message});
    done('Cloudflare 节点名称已核对',message,false,true);return;
  }
  preludeTimings['启动准备']=Math.max(0,Date.now()-started-(preludeTimings['更新候选池']||0));
  const result=await core.execute(env,opts,CF_RANK_POOLS,poolInfo);
  result.stageTimings={...preludeTimings,...result.stageTimings};
  requireOwner();
  const complete=result.selected.reduce((n,x)=>n+x.samples.filter(s=>!s.partial).length,0);
  const coverage=result.lightScreen&&Number.isInteger(result.lightScreen.firstTested)?
    '本轮 '+result.lightScreen.firstTested+'/'+result.lightScreen.firstTotal+' 个入口完成首检，'+result.lightScreen.firstPassed+' 个 IP 首检合格；'+result.lightScreen.secondPassed+' 个 IP 已确认双检合格，'+result.downloadCandidateCount+' 个下载候选中 '+result.downloadTestedCount+' 个通过 Premium 首检并进入下载初筛':
    '本轮 '+result.candidateCount+' 个入口轻量初筛，'+result.reachable+' 个通过，'+result.downloadCandidateCount+' 个下载候选';
  const message=(result.changed?'前十已保存':'列表无变化')+'，Premium 10/10 检测通过，原始和 Surge 订阅均已核对。请刷新原订阅。\n'+coverage+'；'+complete+'/20 次下载复测为完整下载，其余为有效限时样本。\nPremium 仅表示检测时的地区可用性，不验证会员账号资格；仅代表当前网络和本轮候选。';
  const finishedAt=Date.now();
  const lastSuccess={at:finishedAt,network,mode:opts.mode,count:result.selected.length,bytes:result.bytes,premiumBytes:result.premium.bytes,premiumVerified:result.premium.verified,changed:result.changed,elapsedMs:finishedAt-started};
  ownedWrite({running:false,ownerId,startedAt:started,stage:'完成',mode:opts.mode,network,poolInfo,backendRoute,lastSuccess,updatedAt:finishedAt,bytes:result.bytes,result,message});
  done('Cloudflare 优选完成 · '+(result.changed?'已更新':'无变化'),statusText(read()),false,true);
} catch(error) {
  const message=String(error.message||'未知错误');
  const old=stateKey&&ownsRun?read():null;
  if(old&&!isOwner(old)){done('Cloudflare 旧任务已结束',statusText(old),false,false);return;}
  if(old){try{ownedWrite({running:false,stage:'未完成',failureStage:latestProgress&&latestProgress.stage||old.stage,stageTimings:{...preludeTimings,...old.stageTimings,...latestProgress&&latestProgress.stageTimings},backendRetry:null,updatedAt:Date.now(),message},old);}catch(_){}}
  done('Cloudflare 优选未完成',message,true,true);
}
})();
