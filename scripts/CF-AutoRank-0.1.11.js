// CF AutoRank v0.1.11. Credentials are entered by the user; never bundle secrets.
(function (root) {
'use strict';
const MODES = {
  lite: { screenBytes: 131072, sampleBytes: 2000000, finalists: 24 },
  full: { screenBytes: 524288, sampleBytes: 8000000, finalists: 24 }
};
const LIGHT_SCREEN={lite:{candidates:1280,concurrency:8,timeout:4},full:{candidates:2560,concurrency:8,timeout:4}};
const TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
function assert(ok, message) { if (!ok) throw new Error(message); }
function ipNumber(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return parts.reduce((n, x) => n * 256 + Number(x), 0);
}
function numberIP(n) { return [24,16,8,0].map(b => Math.floor(n / Math.pow(2,b)) % 256).join('.'); }
function inPools(ip, pools) {
  const n = ipNumber(ip); if (n === null) return false;
  return pools.some(c => { const [base,bits] = c.split('/'); const size = Math.pow(2,32-Number(bits)); return Math.floor(n/size) === Math.floor(ipNumber(base)/size); });
}
function endpoint(ip, port, pools) {
  assert(inPools(ip,pools) && TLS_PORTS.includes(Number(port)), '节点不属于本工具允许的候选网段或 TLS 端口');
  return { ip: ip, port: Number(port), key: ip+':'+Number(port) };
}
function parseList(text, pools) {
  return String(text).split(/\r?\n/).filter(x => x.trim() && !x.trim().startsWith('#')).map(line => {
    const m = /^\s*(\d+\.\d+\.\d+\.\d+):(\d+)(?:#(.*))?\s*$/.exec(line);
    assert(m, '自定义列表含有汇聚订阅、域名或未知格式；本工具仅管理 IPv4:TLS端口列表');
    return {...endpoint(m[1],Number(m[2]),pools),name:(m[3]||'').trim()};
  });
}
function includeCurrent(text,pools) {
  const lines=String(text).split(/\r?\n/).filter(x=>x.trim()&&!x.trim().startsWith('#'));
  assert(lines.length>0&&lines.length<=1024,'当前节点列表数量异常');
  const exact=lines.map(line=>{
    const m=/^\s*(\d+\.\d+\.\d+\.\d+):(\d+)(?:#.*)?\s*$/.exec(line);
    assert(m&&publicIPv4(m[1])&&TLS_PORTS.includes(Number(m[2])),'当前节点含有非公网 IPv4 或未知 TLS 端口');
    return m[1]+'/32';
  });
  // Existing backend entries remain eligible even if an official range disappears.
  // These exact IPs authorize verification only; they never expand random sampling.
  return Array.from(new Set(pools.concat(exact)));
}
function base64Decode(s) {
  const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let bits=0, value=0, out='';
  s=String(s).replace(/\s/g,''); assert(/^[A-Za-z0-9+/]*={0,2}$/.test(s),'订阅编码无效');
  for (const ch of s.replace(/=+$/,'')) { value=(value<<6)|abc.indexOf(ch); bits+=6; if(bits>=8){bits-=8;out+=String.fromCharCode((value>>bits)&255);} }
  return out;
}
function settings(argument) {
  const parts=String(argument||'').split('|');
  const [action='status',host='',mode='lite',count='160']=parts;
  const password=parts.slice(4).join('|');
  assert(['start','status','cancel','verify','rename'].includes(action),'未知操作');
  assert(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(host),'请填写后台域名，不含 https:// 或路径');
  assert(MODES[mode],'测速档位只能为 lite 或 full');
  const limit=Number(count); assert(Number.isInteger(limit)&&limit>=40&&limit<=1024,'候选数量必须是 40–1024');
  let secret=password;
  if(secret.startsWith('b64:')) { try { secret=decodeURIComponent(Array.from(base64Decode(secret.slice(4))).map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('')); } catch (_) { throw new Error('密码 Base64 编码无效'); } }
  return {action,host:host.toLowerCase(),mode,limit,password:secret};
}
function configGuard(config,host) {
  const sub=config && config['优选订阅生成'];
  assert(sub && sub.local===true && sub['本地IP库'] && sub['本地IP库']['随机IP']===false,'后台不是自定义模式，已保留用户选择');
  assert(config['协议类型']==='trojan' && config['传输协议']==='ws','当前仅支持 Trojan + WebSocket，请保留原设置');
  assert(config.HOST===host && /^[a-fA-F0-9-]{36}$/.test(config.UUID),'节点域名或 UUID 格式不符合当前部署');
  assert(config.PATH==='/' && !config['跳过证书验证'] && !config['随机路径'] && !config['启用0RTT'] && !config.ECH,'当前连接参数超出已验证范围，未更改后台');
  assert(/^[a-fA-F0-9]{32}$/.test(sub.TOKEN),'后台订阅鉴权信息无效');
  return {host:host,password:config.UUID,path:'/',token:sub.TOKEN,
    fingerprint:JSON.stringify([config.HOST,config.HOSTS,config.UUID,config.PATH,config['协议类型'],config['传输协议'],config['跳过证书验证'],config['随机路径'],config['启用0RTT'],config.ECH,sub.local,sub['本地IP库']['随机IP'],sub.TOKEN])};
}
function parseRaw(text, cfg, pools) {
  let decoded;
  try { decoded=decodeURIComponent(Array.from(base64Decode(text)).map(c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0')).join('')); }
  catch(_) {throw new Error('原始订阅不是有效 UTF-8 编码');}
  return decoded.split(/\r?\n/).filter(x=>x.trim()).map(line=>{
    const m=/^trojan:\/\/([^@]+)@(\d+\.\d+\.\d+\.\d+):(\d+)\?([^#]+)(?:#(.*))?$/.exec(line);
    assert(m,'原始订阅包含不支持的节点格式');
    const query={}; m[4].split('&').forEach(p=>{const i=p.indexOf('=');if(i>=0)query[decodeURIComponent(p.slice(0,i))]=decodeURIComponent(p.slice(i+1));});
    assert(decodeURIComponent(m[1])===cfg.password && query.sni===cfg.host && query.host===cfg.host && query.security==='tls' && query.type==='ws' && query.path===cfg.path,'订阅连接参数与后台不一致');
    return {...endpoint(m[2],Number(m[3]),pools),name:decodeURIComponent(m[5]||'')};
  });
}
function parseSurge(text,cfg,pools) {
  let section=''; const nodes=[];
  for(const line of String(text).split(/\r?\n/)) {
    if(line.trim().startsWith('['))section=line.trim();
    if(section!=='[Proxy]' || !/=\s*trojan\s*,/i.test(line))continue;
    const tail=line.slice(line.indexOf('=')+1).split(',').map(x=>x.trim());
    const fields={};tail.slice(3).forEach(x=>{const i=x.indexOf('=');if(i>=0)fields[x.slice(0,i).trim()]=x.slice(i+1).trim();});
    assert(fields.password===cfg.password&&fields.sni===cfg.host&&fields.ws==='true'&&fields['skip-cert-verify']!=='true'&&fields['ws-path']===cfg.path&&String(fields['ws-headers']||'').replace(/"/g,'')==='Host:'+cfg.host,'Surge 转换参数校验失败');
    nodes.push({...endpoint(tail[1],Number(tail[2]),pools),name:line.slice(0,line.indexOf('=')).trim()});
  }
  return nodes;
}
function sameEntries(a,b) { return a.length===b.length && a.every((e,i)=>e.key===b[i].key); }
function sameNamedEntries(a,b) { return sameEntries(a,b)&&a.every((e,i)=>e.name===b[i].name); }
function countryFlag(country) {
  return /^[A-Z]{2}$/.test(country||'')&&!['XX','ZZ','AA'].includes(country)
    ? Array.from(country).map(c=>String.fromCodePoint(127397+c.charCodeAt(0))).join('') : '🌐';
}
// Brackets preserve the observed flag when subconverter removes leading emoji.
function namedEntries(entries) { return entries.map((e,i)=>({...e,name:'【'+countryFlag(e.egress&&e.egress.country)+'】 CF'+(i+1)+'-'+e.ip})); }
function publicIPv4(ip) {
  const n=ipNumber(ip);if(n===null)return false;
  const [a,b,c]=ip.split('.').map(Number);
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&
    !(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||(b===0&&(c===0||c===2))))&&
    !(a===198&&(b===18||b===19||(b===51&&c===100)))&&!(a===203&&b===0&&c===113);
}
async function exitCountry(env,e,cfg,guard,geoCache=new Map()) {
  const samples=[];
  for(let attempt=0;attempt<2;attempt++) {
    await guard();
    const r=await env.probe({descriptor:descriptor(e,cfg),method:'GET',
      url:'https://api.ipify.org?format=json&cf_rank='+env.id(),timeout:8,
      headers:{Accept:'application/json','Cache-Control':'no-cache','Connection':'close'}});
    await guard();
    let ip=null,country=null,countrySource=null;
    if(!r.error&&r.status===200&&typeof r.data==='string'&&r.data.length<1024) {
      try {const data=JSON.parse(r.data);if(typeof data.ip==='string'&&publicIPv4(data.ip))ip=data.ip;}catch(_){}
    }
    if(ip&&typeof env.geoip==='function') {
      try {const code=String(await env.geoip(ip)||'').toUpperCase();if(countryFlag(code)!=='🌐'){country=code;countrySource='Surge GeoIP';}}catch(_){}
    }
    if(ip&&!country) {
      country=geoCache.get(ip)||null;
      if(!country) {
        await guard();
        const lookup=await env.probe({descriptor:descriptor(e,cfg),method:'GET',
          url:'https://ipwho.is/'+ip+'?fields=ip,success,country_code',timeout:8,
          headers:{Accept:'application/json','Cache-Control':'no-cache','Connection':'close'}});
        await guard();
        if(!lookup.error&&lookup.status===200&&typeof lookup.data==='string'&&lookup.data.length<1024) {
          try {
            const data=JSON.parse(lookup.data),code=String(data.country_code||'').toUpperCase();
            if(data.success===true&&data.ip===ip&&countryFlag(code)!=='🌐')country=code;
          }catch(_){}
        }
        if(country)geoCache.set(ip,country);
      }
      if(country)countrySource='IPWhois';
    }
    samples.push({ip,country,countrySource});
  }
  const country=samples.every(s=>s.country&&s.country===samples[0].country)?samples[0].country:null;
  return {country,source:'ipify + Surge GeoIP / IPWhois',checkedAt:env.now(),samples,
    status:country?'verified':samples.every(s=>s.country)?'inconsistent':'unknown'};
}
async function exitNames(env,entries,cfg,guard,update) {
  const observed=[],geoCache=new Map();await update('检测出口国家',0,entries.length);
  for(const e of entries) {observed.push({...e,egress:await exitCountry(env,e,cfg,guard,geoCache)});await update('检测出口国家',observed.length,entries.length);}
  return namedEntries(observed);
}
function candidates(current,pools,limit,rng=Math.random,official=[]) {
  const out=[],seen=new Set(),ips=new Set(),allowed=pools.concat(official);
  const add=e=>{if(!seen.has(e.key)){seen.add(e.key);ips.add(e.ip);out.push(e);}};
  current.forEach(e=>add({...e,candidateSource:'current'}));
  const initial=out.length;
  function shuffled(rows){const a=rows.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  const wide=shuffled(official),legacy=shuffled(pools);let wi=0,li=0;
  let attempts=0;
  while(out.length<limit && attempts<limit*100) {
    attempts++;
    const useOfficial=wide.length>0&&(out.length-initial)%4!==3;
    const cidr=useOfficial?wide[wi++%wide.length]:legacy[li++%legacy.length];
    const [base,bits]=cidr.split('/'); const size=Math.pow(2,32-Number(bits));
    const n=ipNumber(base)+1+Math.floor(rng()*(size-2));
    const ip=numberIP(n),port=[443,2053,8443][Math.floor(rng()*3)];
    if(!ips.has(ip))add({...endpoint(ip,port,allowed),candidateSource:useOfficial?'official':'legacy'});
  }
  assert(out.length>=limit,'候选池生成失败');
  return out;
}
function descriptor(e,cfg) {
  return `CF-Probe-${e.ip}-${e.port} = trojan, ${e.ip}, ${e.port}, password=${cfg.password}, sni=${cfg.host}, skip-cert-verify=false, ws=true, ws-path=/, ws-headers=Host:${cfg.host}, block-quic=on`;
}
function header(headers,name) {
  if(Array.isArray(headers)){const h=headers.find(x=>String(x.field).toLowerCase()===name.toLowerCase());return h?String(h.value):'';}
  const h=Object.keys(headers||{}).find(x=>x.toLowerCase()===name.toLowerCase());return h?String(headers[h]):'';
}
function downloadValid(result,start,size) {
  const end=start+size-1, match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(header(result.headers,'Content-Range'));
  const timed=!!result.error && /timeout|timed out|超时/i.test(String(result.error));
  const bytes=result.bytes||0;
  const valid=result.status===206&&match&&Number(match[1])===start&&Number(match[2])===end&&Number(match[3])>end&&
    bytes>=Math.min(65536,size)&&bytes<=size&&(!result.error||timed)&&result.ms>0&&(!result.error?bytes===size:true);
  return {valid:!!valid,bytes,ms:result.ms,status:result.status||0,partial:!!valid&&bytes<size,
    mbps:valid?Number((bytes*8/result.ms/1000).toFixed(3)):0};
}
async function pool(items,n,fn) {
  let i=0,failure=null,failed=false;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{
    while(i<items.length&&!failed){const index=i++;try{await fn(items[index],index);}catch(error){if(!failed){failed=true;failure=error||new Error('并发请求处理异常');}}}
  }));
  if(failed)throw failure;
}
function median(list){const s=list.slice().sort((a,b)=>a-b);if(!s.length)return null;const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function topDistinct(rows,count) { const sorted=rows.filter(x=>x.valid).slice().sort((a,b)=>b.score-a.score||(a.latency||0)-(b.latency||0)); const seen=new Set();return sorted.filter(x=>{if(seen.has(x.ip))return false;seen.add(x.ip);return true;}).slice(0,count); }
// Light screening coverage is independent of the configurable download cap.
function scanCount(mode) {return LIGHT_SCREEN[mode].candidates;}
function lightValid(r) {return !!r&&!r.error&&r.status===204&&Number.isFinite(r.ms)&&r.ms>0;}
function pickDownloads(rows,current,limit,rng=Math.random) {
  const keys=new Set(current.map(e=>e.key)),seen=new Set();
  const sorted=rows.filter(e=>e.lightSamples&&e.lightSamples.length===2&&e.lightSamples.every(lightValid))
    .map(e=>({...e,lightLatency:Math.max(...e.lightSamples.map(s=>s.ms))}))
    .sort((a,b)=>a.lightLatency-b.lightLatency||a.key.localeCompare(b.key));
  // Deduplicate by IP; keep a passing current endpoint before alternate ports.
  const priority=sorted.filter(e=>keys.has(e.key));
  const unique=priority.concat(sorted).filter(e=>{if(seen.has(e.ip))return false;seen.add(e.ip);return true;});
  const retained=unique.filter(e=>keys.has(e.key)).slice(0,limit);
  const others=unique.filter(e=>!keys.has(e.key));
  const available=Math.min(limit-retained.length,others.length),explore=Math.floor(available/5),fast=available-explore;
  const result=retained.map(e=>({...e,downloadReason:'current'})).concat(others.slice(0,fast).map(e=>({...e,downloadReason:'latency'})));
  // Shuffle the remaining passing entries to keep some bandwidth exploration.
  const remaining=others.slice(fast);
  for(let i=remaining.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
  return result.concat(remaining.slice(0,explore).map(e=>({...e,downloadReason:'exploration'})));
}
async function execute(env,opts,pools,poolInfo=null) {
  const samplingPools=pools,official=poolInfo?poolInfo.official:[];
  pools=pools.concat(official);
  const mode=MODES[opts.mode]; const runId=env.id(); const start=env.now(); let publishing=false;
  const progress={version:1,runId,host:opts.host,mode:opts.mode,startedAt:start,updatedAt:start,stage:'准备',done:0,total:0,bytes:0};
  const initialNetwork=env.networkKey();
  async function update(stage,done,total){Object.assign(progress,{stage,done,total,updatedAt:env.now()});await env.progress(progress);}
  async function guard() {
    assert(env.now()-start<55*60*1000,'本轮结果超过有效期，请重新测速');
    assert(!await env.cancelled(runId),'已取消，未发布结果');
    const currentNetwork=env.networkKey();
    assert(!initialNetwork||!currentNetwork||initialNetwork===currentNetwork,'检测到网络变化，本轮结果已丢弃');
  }
  const req=(method,path,body)=>env.control(method,path,body);
  async function snapshot(first=false) { const config=await req('GET','/admin/config.json');const cfg=configGuard(config,opts.host);const list=await req('GET','/admin/ADD.txt');if(first)pools=includeCurrent(list,pools);const entries=parseList(list,pools);assert(entries.length>0,'原列表为空，不自动初始化');return {cfg,list,entries}; }
  async function raw(cfg){return parseRaw(await req('GET','/sub?token='+cfg.token+'&b64'),cfg,pools);}
  await env.login(opts.host,opts.password);
  const baseline=await snapshot(true);
  assert(sameEntries(await raw(baseline.cfg),baseline.entries),'实际订阅与后台列表尚未一致，请稍后再试');
  await env.backup({host:opts.host,list:baseline.list,entries:baseline.entries,createdAt:start});
  const entries=candidates(baseline.entries,samplingPools,Math.max(scanCount(opts.mode),baseline.entries.length),env.random,official);
  await update('低流量连通与延迟初筛',0,entries.length);
  const reachable=[];let done=0;
  async function connect(e,target) {
    await guard();
    const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:target==='gstatic'?'HEAD':'GET',url:target==='gstatic'?'http://www.gstatic.com/generate_204':'https://www.youtube.com/generate_204',timeout:4,headers:{'Cache-Control':'no-cache','Connection':'close'}});
    return {valid:!r.error&&r.status===204,ms:r.ms,status:r.status||0};
  }
  progress.lightRequests=0;
  await pool(entries,LIGHT_SCREEN[opts.mode].concurrency,async e=>{
    const lightSamples=[];
    for(let attempt=0;attempt<2;attempt++) {
      await guard();progress.lightRequests++;
      const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:'HEAD',
        url:'http://www.gstatic.com/generate_204?cf_rank_light='+runId+'-'+env.id(),timeout:LIGHT_SCREEN[opts.mode].timeout,
        headers:{'Cache-Control':'no-cache','Connection':'close'}});
      await guard();
      const sample={error:r.error||null,status:r.status||0,ms:r.ms};lightSamples.push(sample);
      if(!lightValid(sample))break;
    }
    if(lightSamples.length===2&&lightSamples.every(lightValid))reachable.push({...e,lightSamples});
    await update('低流量连通与延迟初筛',++done,entries.length);
  });
  assert(reachable.length>=10,'可连接候选不足 10 个，保留原订阅');
  const downloadEntries=pickDownloads(reachable,baseline.entries,opts.limit,env.random);
  assert(downloadEntries.length>=10,'有效下载候选不足 10 个，保留原订阅');
  progress.downloadCandidateCount=downloadEntries.length;
  async function download(e,size,seconds) {
    await guard(); const offset=Math.floor(env.random()*150000000);
    const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:'GET',url:'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg?cf_rank='+runId+'-'+env.id(),timeout:seconds,binary:true,
      headers:{Range:'bytes='+offset+'-'+(offset+size-1),'Accept-Encoding':'identity','Cache-Control':'no-cache'}});
    progress.bytes+=r.bytes||0;
    assert(r.status!==200,'下载源未遵守 Range，已停止，保留原订阅');
    return downloadValid(r,offset,size);
  }
  done=0;const screened=[];await update('下载初筛',0,downloadEntries.length);
  await pool(downloadEntries,3,async e=>{const d=await download(e,mode.screenBytes,5);if(d.valid)screened.push({...e,valid:true,score:d.mbps});await update('下载初筛',++done,downloadEntries.length);});
  const finalists=topDistinct(screened,mode.finalists);
  assert(finalists.length>=10,'有效下载候选不足 10 个，保留原订阅');
  const ranking=[];done=0;
  for(const e of finalists) {
    await update('稳定性与双次下载复测',done,finalists.length);
    const checks=[];
    for(let n=0;n<3;n++) { checks.push(await connect(e,'gstatic'));checks.push(await connect(e,'youtube'));if(checks.some(x=>!x.valid))break; }
    if(checks.length===6&&checks.every(x=>x.valid)) {
      const samples=[await download(e,mode.sampleBytes,8),await download(e,mode.sampleBytes,8)];
      ranking.push({...e,valid:samples.every(x=>x.valid),score:Math.min(...samples.map(x=>x.mbps)),latency:median(checks.map(x=>x.ms)),checks,samples});
    }
    await update('稳定性与双次下载复测',++done,finalists.length);
  }
  const selected=[];
  for(const e of topDistinct(ranking,ranking.length)) { const check=await connect(e,'youtube');if(check.valid)selected.push(e);if(selected.length===10)break; }
  assert(selected.length===10 && new Set(selected.map(x=>x.ip)).size===10,'稳定有效候选不足 10 个，保留原订阅');
  const expectedNames=await exitNames(env,selected,baseline.cfg,guard,update);
  const proposed=expectedNames.map(e=>e.key+'#'+e.name).join('\n');
  await guard();await update('发布前核对',0,1);
  const fresh=await snapshot();
  assert(fresh.cfg.fingerprint===baseline.cfg.fingerprint&&fresh.list===baseline.list,'测速期间后台被改动，已保留当前设置');
  assert(sameEntries(await raw(fresh.cfg),baseline.entries),'测速期间实际订阅已改变，跳过发布');
  await guard();
  const outcome={runId,startedAt:start,finishedAt:env.now(),host:opts.host,mode:opts.mode,candidateCount:entries.length,reachable:reachable.length,screened:screened.length,finalists:finalists.length,bytes:progress.bytes,selected:expectedNames.map(({ip,port,key,name,egress,score,latency,samples})=>({ip,port,key,name,egress,score,latency,samples})),changed:false,verified:false};
  outcome.poolInfo=poolInfo;
  outcome.candidateSources=entries.reduce((counts,e)=>{counts[e.candidateSource]=(counts[e.candidateSource]||0)+1;return counts;},{});
  outcome.lightRequests=progress.lightRequests;
  outcome.downloadCandidateCount=downloadEntries.length;
  outcome.downloadReasons=downloadEntries.reduce((counts,e)=>{counts[e.downloadReason]=(counts[e.downloadReason]||0)+1;return counts;},{});
  outcome.downloadCandidates=downloadEntries.map(({ip,port,key,lightLatency,downloadReason})=>({ip,port,key,lightLatency,downloadReason}));
  async function verify(cfg,expected) {
    const a=await raw(cfg);
    const b=parseSurge(await req('GET','/sub?token='+cfg.token+'&surge'),cfg,pools);
    return sameNamedEntries(a,expected)&&sameNamedEntries(b,expected);
  }
  if(baseline.list.trim()===proposed) { outcome.verified=await verify(fresh.cfg,expectedNames);assert(outcome.verified,'列表未变，但订阅转换未核对通过');return outcome; }
  try {
    publishing=true;await update('保存与订阅验证',0,1);
    const response=await req('POST','/admin/ADD.txt',proposed);
    assert(response&&response.success===true,'后台未确认保存成功');
    outcome.changed=true;
    for(const wait of [0,3000,12000,30000,60000]) {
      if(wait)await env.sleep(wait);
      const check=await snapshot();
      if(check.cfg.fingerprint!==baseline.cfg.fingerprint)throw new Error('保存后后台连接参数发生变化');
      if(check.list.trim()===proposed && await verify(check.cfg,expectedNames)) {outcome.verified=true;break;}
    }
    assert(outcome.verified,'订阅传播后仍未核对通过');
    outcome.publishedAt=env.now();await update('完成，订阅已验证',1,1);return outcome;
  } catch(error) {
    let rollback='未覆盖其他修改';
    try {
      const check=await snapshot();
      if(check.cfg.fingerprint===baseline.cfg.fingerprint && check.list.trim()===proposed) {
        const restored=await req('POST','/admin/ADD.txt',baseline.list);
        rollback=restored&&restored.success===true?'已请求恢复备份，需检查订阅传播':'恢复备份未获确认';
      }
    } catch(_) {rollback='无法确认恢复，请检查后台';}
    throw new Error('发布验证失败；'+rollback);
  }
}
async function renameOnly(env,opts,pools) {
  const startedAt=env.now(),runId=env.id(),initialNetwork=env.networkKey();
  const req=(method,path,body)=>env.control(method,path,body);
  async function guard() {
    assert(env.now()-startedAt<10*60*1000,'改名操作已超时，请重新运行');assert(!await env.cancelled(runId),'已取消，未改名');
    const currentNetwork=env.networkKey();assert(!initialNetwork||!currentNetwork||initialNetwork===currentNetwork,'检测到网络变化，保留原名称');
  }
  async function snapshot(first=false) {
    const cfg=configGuard(await req('GET','/admin/config.json'),opts.host);
    const list=await req('GET','/admin/ADD.txt');if(first)pools=includeCurrent(list,pools);const entries=parseList(list,pools);
    assert(entries.length===10&&new Set(entries.map(e=>e.ip)).size===10,'现有列表不是 10 个不同 IP，保留原列表');
    return {cfg,list,entries};
  }
  async function subscriptions(cfg,expected) {
    const raw=parseRaw(await req('GET','/sub?token='+cfg.token+'&b64'),cfg,pools);
    const surge=parseSurge(await req('GET','/sub?token='+cfg.token+'&surge'),cfg,pools);
    return sameNamedEntries(raw,expected)&&sameNamedEntries(surge,expected);
  }
  await env.login(opts.host,opts.password);
  const baseline=await snapshot(true);
  assert(await subscriptions(baseline.cfg,baseline.entries),'后台与实际订阅尚未一致，暂不改名');
  await env.backup({host:opts.host,list:baseline.list,entries:baseline.entries,createdAt:startedAt});
  const selected=await exitNames(env,baseline.entries,baseline.cfg,guard,
    (stage,done,total)=>env.progress({runId,startedAt,updatedAt:env.now(),stage,done,total,bytes:0}));
  const proposed=selected.map(e=>e.key+'#'+e.name).join('\n');
  const outcome={runId,startedAt,selected,changed:false,verified:false};
  await guard();
  const fresh=await snapshot();
  assert(fresh.cfg.fingerprint===baseline.cfg.fingerprint&&fresh.list===baseline.list,'操作期间后台被改动，已保留当前设置');
  assert(await subscriptions(fresh.cfg,baseline.entries),'操作期间实际订阅已改变，跳过改名');
  if(baseline.list.trim()===proposed)return {...outcome,verified:true};
  await guard();
  try {
    const response=await req('POST','/admin/ADD.txt',proposed);
    assert(response&&response.success===true,'后台未确认改名成功');outcome.changed=true;
    for(const wait of [0,3000,12000,30000,60000]) {
      if(wait)await env.sleep(wait);
      const check=await snapshot();
      assert(check.cfg.fingerprint===baseline.cfg.fingerprint&&check.list.trim()===proposed,'改名后后台发生变化');
      if(await subscriptions(check.cfg,selected))return {...outcome,verified:true,finishedAt:env.now()};
    }
    throw new Error('原始或 Surge 订阅名称尚未生效');
  } catch(error) {
    let rollback='未覆盖其他修改';
    try {
      const check=await snapshot();
      if(check.cfg.fingerprint===baseline.cfg.fingerprint&&check.list.trim()===proposed) {
        const restored=await req('POST','/admin/ADD.txt',baseline.list);
        rollback=restored&&restored.success===true?'已请求恢复原名称，需检查订阅传播':'恢复原名称未获确认';
      }
    } catch(_) {rollback='无法确认恢复，请检查后台';}
    throw new Error('改名验证失败；'+rollback);
  }
}
const api={MODES,LIGHT_SCREEN,settings,ipNumber,numberIP,inPools,endpoint,parseList,includeCurrent,base64Decode,configGuard,parseRaw,parseSurge,sameEntries,sameNamedEntries,namedEntries,countryFlag,publicIPv4,exitCountry,candidates,descriptor,downloadValid,topDistinct,scanCount,lightValid,pickDownloads,execute,renameOnly};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFRankCore=api;
})(typeof globalThis==='object'?globalThis:this);

(function(root){
'use strict';
const SOURCES=[{kind:'text',url:'https://www.cloudflare.com/ips-v4'},{kind:'api',url:'https://api.cloudflare.com/client/v4/ips'}];
const MAX_AGE=7*86400000;
function number(ip) {
 const parts=ip.split('.');
 if(parts.length!==4||parts.some(s=>! /^(0|[1-9]\d{0,2})$/.test(s)||Number(s)>255))throw new Error('候选网段格式无效');
 return parts.reduce((n,s)=>n*256+Number(s),0);
}
function range(cidr) {
 if(typeof cidr!=='string'||!/^\d+\.\d+\.\d+\.\d+\/(?:[89]|[12]\d|30)$/.test(cidr))throw new Error('候选网段格式无效');
 const [ip,bits]=cidr.split('/'),start=number(ip),size=2**(32-Number(bits));
 if(start%size)throw new Error('候选网段未对齐');
 return {start,end:start+size-1,size};
}
const BLOCKED=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24'].map(range).concat([{start:224*2**24,end:2**32-1}]);
function validate(input) {
 if(!Array.isArray(input)||input.length<5||input.length>128)throw new Error('官方网段数量异常');
 const ranges=input.map(range).sort((a,b)=>a.start-b.start);
 let total=0;
 for(let i=0;i<ranges.length;i++) {
  const r=ranges[i];
  if(BLOCKED.some(b=>r.start<=b.end&&r.end>=b.start)||(i&&ranges[i-1].end>=r.start))throw new Error('官方网段包含保留地址或重叠范围');
  total+=r.size;
 }
 if(total<100000||total>16777216)throw new Error('官方网段地址规模异常');
 return input.slice();
}
function parse(response,kind) {
 if(!response||response.error||response.status!==200||typeof response.data!=='string'||response.data.length>65536)throw new Error('官方网段获取失败');
 let ranges;
 if(kind==='api') {
  const body=JSON.parse(response.data);
  if(body.success!==true||!body.result)throw new Error('官方接口返回失败');
  ranges=body.result.ipv4_cidrs;
 }else ranges=response.data.trim().split(/\r?\n/).map(s=>s.trim());
 return validate(ranges);
}
function describe(official,source,fetchedAt) {
 return {official,source,fetchedAt,rangeCount:official.length,addressCount:official.reduce((n,s)=>n+range(s).size,0)};
}
function fallback(bundled,cache,now) {
 if(cache&&cache.version===1&&SOURCES.some(s=>s.url===cache.url)&&Number.isFinite(cache.fetchedAt)&&cache.fetchedAt<=now&&now-cache.fetchedAt<=MAX_AGE) {
  try{return describe(validate(cache.ranges),'cache',cache.fetchedAt);}catch(_){}
 }
 return describe(validate(bundled),'bundled',null);
}
async function refresh(env,bundled) {
 for(const source of SOURCES) {
  await env.guard();let ranges;
  try {ranges=parse(await env.fetch(source.url),source.kind);}catch(_){}
  await env.guard();
  if(ranges) {
   const fetchedAt=env.now();
   const cacheSaved=await env.save({version:1,url:source.url,fetchedAt,ranges});
   await env.guard();
   return {...describe(ranges,'live-'+source.kind,fetchedAt),cacheSaved:cacheSaved!==false};
  }
 }
 await env.guard();
 return fallback(bundled,env.cached,env.now());
}
function label(info) {
 if(!info)return '未记录';
 const source={'live-text':'官方在线','live-api':'官方备用接口',cache:'最近缓存',bundled:'内置备份'}[info.source]||'未知来源';
 return source+' · '+info.rangeCount+' 网段';
}
const api={SOURCES,MAX_AGE,validate,parse,fallback,refresh,label};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFPoolSource=api;
})(typeof globalThis==='object'?globalThis:this);

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
      count:r.selected.length,bytes:s.bytes||r.bytes||0,changed:!!r.changed,
      elapsedMs:(r.finishedAt||s.updatedAt)-(r.startedAt||s.startedAt||s.updatedAt)};
  }
  return null;
}
function mainContent(s,mode) {
  const last=lastSuccess(s);
  if(!last)return '尚无成功记录 · '+(mode==='full'?'完整档':'省流档')+'\n点击开始；进度见下方';
  return (last.changed?'上次更新 ':'上次核对 ')+dateText(last.at)+' · '+last.count+' 节点\n'
    +networkText(last.network)+' · '+(last.mode==='full'?'完整':'省流')+' · '+Math.round(last.bytes/1000000)+' MB';
}
function progressContent(s,now) {
  if(!s.stage)return 'v0.1.11 已加载 · 尚未开始\n点击上方面板运行完整优选';
  const traffic=Math.round((s.bytes||0)/1000000)+' MB';
  const poolNote=s.poolInfo&&s.poolInfo.source==='cache'?' · 缓存池':s.poolInfo&&s.poolInfo.source==='bundled'?' · 内置池':'';
  if(s.running) {
    const age=Math.max(0,now-(s.updatedAt||s.startedAt||now));
    const names={'正在登录后台':'登录后台','连通性初筛':'连通检查','低流量连通与延迟初筛':'轻量初筛','稳定性与双次下载复测':'双次复测','保存与订阅验证':'保存并核对','完成，订阅已验证':'订阅已核对'};
    const stage=(names[s.stage]||s.stage)+(s.total?' '+(s.done||0)+'/'+s.total:'');
    if(age>=STALE_MS)return '可能暂停或中断 · '+stage+'\n'+duration(age)+'无进展 · '+(age>=RESTART_MS?'点上方重新开始':'保持前台稍候');
    if(s.cancelRequested)return '已请求取消 · '+stage+'\n'+traffic+' · 等待当前请求结束';
    const percent=s.total?' · '+Math.min(100,Math.floor((s.done||0)/s.total*100))+'%':'';
    return stage+percent+poolNote+'\n'+duration(now-(s.startedAt||now))+' · 下载 '+traffic+' · '+duration(age)+'前进展';
  }
  if(s.stage==='名称已核对')return '10 个名称已核对 · 国旗 '+(s.nameResult?s.nameResult.selected.filter(e=>e.egress&&e.egress.country).length:0)+'/10\n未运行下载测速 · 请刷新订阅';
  if(s.stage==='完成')return '完成 · '+(s.result&&s.result.selected?s.result.selected.length:10)+' 节点已核对'+poolNote+'\n'
    +duration((s.updatedAt||now)-(s.startedAt||s.result&&s.result.startedAt||s.updatedAt||now))+' · '+traffic+' · 请刷新订阅';
  return s.stage+' · '+traffic+'\n'+(s.message||'查看脚本日志了解详情');
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

const CF_RANK_POOLS=["162.159.32.0/20","8.35.211.0/24","8.39.125.0/24","188.164.248.0/24","108.162.198.0/24","162.159.38.0/23","91.193.58.0/23","172.66.0.0/22","104.16.144.0/20","104.16.240.0/20","104.17.16.0/20","104.17.48.0/20","104.17.96.0/20","104.17.112.0/20","104.17.144.0/20","104.17.160.0/20","104.17.176.0/20","104.17.208.0/20","104.18.33.0/24","104.19.32.0/22","104.19.48.0/21","104.19.144.0/21","198.41.208.0/23","104.26.0.0/20","172.67.64.0/20"];
const CF_RANK_OFFICIAL=["173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22","141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20","197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13","104.24.0.0/14","172.64.0.0/13","131.0.72.0/22"];
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
const UA='CF-Edge-AutoRank/0.1.11';
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
  if(s.updatedAt)lines.push('更新：'+new Date(s.updatedAt).toLocaleString());
  if(s.network)lines.push('本轮网络：'+ui.networkText(s.network));
  if(s.poolInfo)lines.push('候选池：'+poolSource.label(s.poolInfo)+(s.poolInfo.fetchedAt?' · 获取于 '+ui.dateText(s.poolInfo.fetchedAt):''));
  if(s.message)lines.push(s.message);
  if(s.result)lines.push(...s.result.selected.map((x,i)=>String(i+1).padStart(2,'0')+' '+x.key+' · '+x.score.toFixed(2)+' Mbps'));
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
    const url=origin+path+(path.includes('?')?'&':'?')+'cf_rank_read='+Date.now();
    const r=await request({url,body,policy:'DIRECT',timeout:35,'auto-cookie':true,'auto-redirect':false,
      headers:{'User-Agent':UA,'Cache-Control':'no-cache','Content-Type':'text/plain;charset=utf-8'}},method);
    if(r.error||r.status!==200)throw new Error(r.status===302?'后台登录已失效，请重新运行':'后台请求失败，请检查网络；未输出凭据');
    if(path==='/admin/config.json'||method==='POST')return decodeJSON(r.data,'后台');
    if(typeof r.data!=='string')throw new Error('后台返回的数据格式不正确');
    return r.data;
  }
  async function login(host,password){
    const r=await request({url:origin+'/login',body:'password='+encodeURIComponent(password),policy:'DIRECT',timeout:20,
      'auto-cookie':true,'auto-redirect':false,headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'}},'POST');
    if(r.error||![200,302].includes(r.status))throw new Error('后台无法连接或登录失败');
    if(r.status===200){let data;try{data=JSON.parse(r.data);}catch(_){throw new Error('后台密码未被接受，请在模块参数检查');}if(!data.success)throw new Error('后台登录未成功');}
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
  const message=(result.changed?'前十已保存':'列表无变化')+'，原始和 Surge 订阅均已核对。请刷新原订阅。\n本轮 '+result.candidateCount+' 个入口轻量初筛，'+result.reachable+' 个通过，'+result.downloadCandidateCount+' 个下载候选；'+complete+'/20 次复测为完整下载，其余为有效限时样本。\n仅代表当前网络和本轮候选。';
  const finishedAt=Date.now();
  const lastSuccess={at:finishedAt,network,mode:opts.mode,count:result.selected.length,bytes:result.bytes,changed:result.changed,elapsedMs:finishedAt-started};
  write({running:false,ownerId,startedAt:started,stage:'完成',mode:opts.mode,network,poolInfo,lastSuccess,updatedAt:finishedAt,bytes:result.bytes,result,message});
  done('Cloudflare 优选完成 · '+(result.changed?'已更新':'无变化'),statusText(read()),false,true);
} catch(error) {
  const message=String(error.message||'未知错误');
  if(stateKey&&ownsRun&&!isOwner()){done('Cloudflare 旧任务已结束',statusText(read()),false,false);return;}
  if(stateKey&&ownsRun){const old=read();try{write({...old,running:false,stage:'未完成',updatedAt:Date.now(),message});}catch(_){}}
  done('Cloudflare 优选未完成',message,true,true);
}
})();
