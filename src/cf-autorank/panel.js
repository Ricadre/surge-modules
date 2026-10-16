(function (root) {
'use strict';
const STALE_MS=90000, RESTART_MS=180000;
function clean(value,limit=12) {
  const text=String(value||'').replace(/[\r\n\t\u0000-\u001f]/g,' ').trim();
  return Array.from(text).length>limit?Array.from(text).slice(0,limit-1).join('')+'…':text;
}
function networkInfo(n) {
  n=n||{};
  const iface=n.v4&&n.v4.primaryInterface||n.v6&&n.v6.primaryInterface||'';
  if(/^(pdp_ip|rmnet)/.test(iface))return {kind:'cellular',name:'蜂窝网络'};
  const ssid=n.wifi&&n.wifi.ssid;
  if(ssid)return {kind:'wifi',name:String(ssid).replace(/[\r\n\t\u0000-\u001f]/g,' ').trim()};
  if(n.wifi)return {kind:'wifi',name:''};
  return {kind:'unknown',name:''};
}
function networkText(n) {
  if(!n)return '网络未记录';
  if(n.kind==='wifi')return n.name?'Wi-Fi '+clean(n.name):'Wi-Fi 名称不可用';
  if(n.kind==='cellular')return '蜂窝网络';
  return '网络名称不可用';
}
function dateText(ms) {
  if(!ms)return '时间未记录';
  const d=new Date(ms+8*3600000),pad=n=>String(n).padStart(2,'0');
  return pad(d.getUTCMonth()+1)+'/'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
function duration(ms) {
  const seconds=Math.max(0,Math.floor(ms/1000));
  return seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+String(seconds%60).padStart(2,'0')+'秒';
}
function lastSuccess(s) {
  if(s.lastSuccess)return s.lastSuccess;
  if(s.result&&s.result.selected&&(s.result.verified||s.stage==='完成')) {
    const r=s.result;
    return {at:r.publishedAt||r.finishedAt||s.updatedAt,network:s.network||null,mode:s.mode||r.mode,
      count:r.selected.length,bytes:s.bytes||r.bytes||0,premiumBytes:r.premium&&r.premium.bytes||0,premiumVerified:r.premium&&r.premium.verified||0,changed:!!r.changed,
      elapsedMs:(r.finishedAt||s.updatedAt)-(r.startedAt||s.startedAt||s.updatedAt)};
  }
  return null;
}
function mainContent(s,mode) {
  const last=lastSuccess(s);
  if(!last)return '尚无成功记录 · '+(mode==='full'?'完整档':'省流档')+'\n点击开始；进度见下方';
  return (last.changed?'上次更新 ':'上次核对 ')+dateText(last.at)+' · '+last.count+' 节点'+(last.premiumVerified===10?' · YT✓':'')+'\n'
    +networkText(last.network)+' · '+(last.mode==='full'?'完整':'省流')+' · '+Math.round((last.bytes+(last.premiumBytes||0))/1000000)+' MB';
}
function progressContent(s,now) {
  if(!s.stage)return 'v0.1.14 已加载 · 尚未开始\n点击上方面板运行完整优选';
  const premium=s.premium||s.result&&s.result.premium;
  const traffic=Math.round(((s.bytes||0)+(premium&&premium.bytes||0))/1000000)+' MB';
  const poolNote=s.poolInfo&&s.poolInfo.source==='cache'?' · 缓存池':s.poolInfo&&s.poolInfo.source==='bundled'?' · 内置池':'';
  if(s.running) {
    const age=Math.max(0,now-(s.updatedAt||s.startedAt||now));
    const names={'正在登录后台':'登录后台','连通性初筛':'连通检查','低流量连通与延迟初筛':'轻量初筛','稳定性与双次下载复测':'双次复测','YouTube Premium 检测':'Premium 筛选','YouTube Premium 发布前复核':'Premium 复核','后备 Premium 检测':'后备 Premium','后备节点速度复测':'补选复测','更新 Premium 检测记录':'更新 Premium','保存与订阅验证':'保存并核对','完成，订阅已验证':'订阅已核对'};
    const stage=(names[s.stage]||s.stage)+(s.total?' '+(s.done||0)+'/'+s.total:'');
    if(age>=STALE_MS)return '可能暂停或中断 · '+stage+'\n'+duration(age)+'无进展 · '+(age>=RESTART_MS?'点上方重新开始':'保持前台稍候');
    if(s.cancelRequested)return '已请求取消 · '+stage+'\n'+traffic+' · 等待当前请求结束';
    if(s.backendRetry)return stage+'\n'+s.backendRetry+' · '+traffic;
    if(s.stage==='YouTube Premium 检测'||s.stage==='YouTube Premium 发布前复核')return stage+'\n'
      +(s.stage==='YouTube Premium 检测'?'通过 '+(premium&&premium.passed||0):'复核 '+(premium&&premium.verified||0))+'/10 · 正文 '+traffic;
    if(['后备 Premium 检测','后备节点速度复测','更新 Premium 检测记录'].includes(s.stage))return stage+'\n已选 '+(premium&&premium.passed||0)+'/10 · 正文 '+traffic;
    const percent=s.total?' · '+Math.min(100,Math.floor((s.done||0)/s.total*100))+'%':'';
    return stage+percent+poolNote+'\n'+duration(now-(s.startedAt||now))+' · 正文 '+traffic+' · '+duration(age)+'前进展';
  }
  if(s.stage==='名称已核对')return '10 个名称已核对 · 国旗 '+(s.nameResult?s.nameResult.selected.filter(e=>e.egress&&e.egress.country).length:0)+'/10\n未运行下载测速 · 请刷新订阅';
  if(s.stage==='完成')return '完成 · '+(s.result&&s.result.selected?s.result.selected.length:10)+' 节点已核对'+(premium&&premium.verified===10?' · Premium 10/10':'')+poolNote+'\n'
    +duration((s.updatedAt||now)-(s.startedAt||s.result&&s.result.startedAt||s.updatedAt||now))+' · '+traffic+' · 请刷新订阅';
  return s.stage+(s.failureStage?' · '+s.failureStage:'')+' · '+traffic+'\n'+(s.message||'查看脚本日志了解详情');
}
function view(kind,s,now,mode,error) {
  const progress=kind==='status';
  const stale=s.running&&now-(s.updatedAt||s.startedAt||now)>=STALE_MS;
  return {title:progress?'Cloudflare 测速进度':'Cloudflare 一键优选',
    content:error?'本轮未完成\n'+error:progress?progressContent(s,now):mainContent(s,mode),
    icon:progress?'chart.bar.fill':'cloud.fill',
    'icon-color':error||s.stage==='未完成'?'#E05252':stale?'#D98913':'#F48120'};
}
const api={STALE_MS,RESTART_MS,networkInfo,networkText,dateText,duration,lastSuccess,view};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFPanelUI=api;
})(typeof globalThis==='object'?globalThis:this);
