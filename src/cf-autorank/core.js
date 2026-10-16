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
