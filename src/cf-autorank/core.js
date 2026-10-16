(function (root) {
'use strict';
const premium=typeof module==='object'&&module.exports?require('./youtube-premium.js'):root.CFYouTubePremium;
const MODES = {
  lite: { screenBytes: 131072, sampleBytes: 2000000, finalists: 24, reserveFinalists: 24 },
  full: { screenBytes: 524288, sampleBytes: 8000000, finalists: 24, reserveFinalists: 24 }
};
const LIGHT_SCREEN={lite:{candidates:1280,concurrency:8,maxConcurrency:16,batchSize:64,timeout:4},full:{candidates:2560,concurrency:8,maxConcurrency:16,batchSize:64,timeout:4}};
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
async function exitNames(env,entries,cfg,guard,update,concurrency=1) {
  const observed=new Array(entries.length),geoCache=new Map();let done=0;await update('检测出口国家',0,entries.length);
  await pool(entries,concurrency,async(e,i)=>{observed[i]={...e,egress:await exitCountry(env,e,cfg,guard,geoCache)};await update('检测出口国家',++done,entries.length);});
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
// Batches drain before changing concurrency; degraded batches are replaced by
// fresh measurements at the original load, including their successful entries.
async function adaptiveLightScreen(entries,options,probe,report=async()=>{}) {
  const rows=[],stats={maxConcurrency:options.concurrency,backoffs:0,rechecked:0,batches:[]};
  let width=options.concurrency,baseline=null,cooldown=0;
  function summarize(result) {
    const good=result.filter(e=>e.lightSamples.length===2&&e.lightSamples.every(lightValid));
    return {good:good.length,failed:1-good.length/result.length,latency:median(good.map(e=>Math.max(...e.lightSamples.map(x=>x.ms))))};
  }
  for(let offset=0;offset<entries.length;offset+=options.batchSize) {
    const batch=entries.slice(offset,offset+options.batchSize);
    async function measure(n,rechecking) {
      const result=new Array(batch.length);let done=0;
      stats.maxConcurrency=Math.max(stats.maxConcurrency,n);
      await pool(batch,n,async(e,i)=>{
        result[i]={...e,lightSamples:await probe(e)};
        done++;await report({done:rechecking?done:offset+done,total:rechecking?batch.length:entries.length,concurrency:n,rechecking,stats});
      });
      return result;
    }
    let result=await measure(width,false),sample=summarize(result);
    const elevated=width>options.concurrency&&baseline&&(
      sample.failed>baseline.failed+0.20||
      sample.latency!==null&&baseline.latency!==null&&sample.latency>Math.max(baseline.latency*1.6,baseline.latency+150));
    stats.batches.push({offset,count:batch.length,concurrency:width,...sample,rechecked:!!elevated});
    if(elevated) {
      stats.backoffs++;stats.rechecked+=batch.length;width=options.concurrency;cooldown=2;
      result=await measure(width,true);sample=summarize(result);
      stats.batches.push({offset,count:batch.length,concurrency:width,...sample,recovery:true});
      await report({done:offset+batch.length,total:entries.length,concurrency:width,rechecking:false,stats});
    }
    rows.push(...result.filter(e=>e.lightSamples.length===2&&e.lightSamples.every(lightValid)));
    if(width===options.concurrency)baseline=sample;
    if(cooldown>0)cooldown--;
    else if(stats.backoffs<2&&sample.good>=8)width=Math.min(options.maxConcurrency,width+4);
  }
  return {rows,stats};
}
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
async function selectiveLightScreen(entries,current,limit,options,probe,report=async()=>{},rng=Math.random) {
  const unique=new Map();entries.forEach(e=>{if(!unique.has(e.key))unique.set(e.key,e);});
  const states=Array.from(unique.values(),entry=>({entry,first:null,second:undefined}));
  const groups=new Map(),currentKeys=new Set(current.map(e=>e.key));
  for(const state of states) {
    if(!groups.has(state.entry.ip))groups.set(state.entry.ip,{ip:state.entry.ip,states:[]});
    groups.get(state.entry.ip).states.push(state);
  }
  // One random position per IP, assigned before any second observation. A port
  // cannot buy extra exploration chances, and later quota changes keep this order.
  const explorationOrder=Array.from(groups.values());
  for(let i=explorationOrder.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[explorationOrder[i],explorationOrder[j]]=[explorationOrder[j],explorationOrder[i]];}
  explorationOrder.forEach((g,i)=>{g.priority=i;});
  const stats={firstTotal:states.length,firstTested:0,firstPassed:0,firstPassedEntries:0,firstRequests:0,
    secondTested:0,secondPassed:0,secondPassedEntries:0,secondRequests:0,skippedSecond:0,selectionComplete:false,
    maxConcurrency:options.concurrency,firstConcurrency:options.concurrency,secondConcurrency:options.secondConcurrency||options.concurrency,
    backoffs:0,rechecked:0,batches:[],allocation:{current:0,latency:0,exploration:0}};
  const firstIPs=new Map(),secondIPs=new Map();
  function adjust(map,ip,delta) {const count=(map.get(ip)||0)+delta;if(count)map.set(ip,count);else map.delete(ip);}
  function storeSample(state,field,sample) {
    const oldFirst=lightValid(state.first),oldSecond=oldFirst&&lightValid(state.second);
    // null marks an attempted but unknown result; undefined means untested.
    state[field]=sample===undefined?null:sample;
    const newFirst=lightValid(state.first),newSecond=newFirst&&lightValid(state.second);
    if(oldFirst!==newFirst){const delta=newFirst?1:-1;stats.firstPassedEntries+=delta;adjust(firstIPs,state.entry.ip,delta);}
    if(oldSecond!==newSecond){const delta=newSecond?1:-1;stats.secondPassedEntries+=delta;adjust(secondIPs,state.entry.ip,delta);}
    stats.firstPassed=firstIPs.size;stats.secondPassed=secondIPs.size;
  }
  async function emit(phase,done,total,concurrency,rechecking=false) {
    await report({phase,done,total,concurrency,rechecking,stats});
  }
  let width=options.concurrency,baseline=null,cooldown=0;
  for(let offset=0;offset<states.length;offset+=options.batchSize) {
    const batch=states.slice(offset,offset+options.batchSize);
    async function measure(n,rechecking) {
      let done=0;stats.maxConcurrency=Math.max(stats.maxConcurrency,n);stats.firstConcurrency=n;
      if(rechecking)batch.forEach(s=>{storeSample(s,'first',null);});
      await pool(batch,n,async state=>{
        stats.firstRequests++;storeSample(state,'first',await probe(state.entry,1));done++;
        if(!rechecking)stats.firstTested=offset+done;
        await emit(rechecking?'first-recheck':'first',rechecking?done:offset+done,rechecking?batch.length:states.length,n,rechecking);
      });
      const good=batch.filter(s=>lightValid(s.first));
      return {good:good.length,failed:1-good.length/batch.length,latency:median(good.map(s=>s.first.ms))};
    }
    let sample=await measure(width,false);
    const elevated=width>options.concurrency&&baseline&&(
      sample.failed>baseline.failed+0.20||sample.latency!==null&&baseline.latency!==null&&
      sample.latency>Math.max(baseline.latency*1.6,baseline.latency+150));
    stats.batches.push({offset,count:batch.length,concurrency:width,...sample,rechecked:!!elevated});
    if(elevated) {
      stats.backoffs++;stats.rechecked+=batch.length;width=options.concurrency;cooldown=2;
      sample=await measure(width,true);stats.batches.push({offset,count:batch.length,concurrency:width,...sample,recovery:true});
      await emit('first',offset+batch.length,states.length,width);
    }
    if(width===options.concurrency)baseline=sample;
    if(cooldown>0)cooldown--;else if(stats.backoffs<2&&sample.good>=8)width=Math.min(options.maxConcurrency,width+4);
  }
  // Reuse only the final concurrency that actually completed the first pass.
  // The selectively measured second-pass sample must not set a new baseline.
  stats.secondConcurrency=Math.max(1,Math.min(16,options.maxConcurrency,options.secondConcurrency||stats.firstConcurrency));
  const firstPassed=states.filter(s=>lightValid(s.first));
  const compare=(a,b)=>a.lightLatency-b.lightLatency||a.key.localeCompare(b.key);
  function row(state) {return {...state.entry,lightSamples:[state.first,state.second],lightLatency:Math.max(state.first.ms,state.second.ms)};}
  function best(group,onlyCurrent=false) {
    return group.states.filter(s=>lightValid(s.first)&&lightValid(s.second)&&(!onlyCurrent||currentKeys.has(s.entry.key)))
      .map(row).sort(compare)[0];
  }
  async function seconds(pending,phase) {
    const todo=pending.filter(s=>lightValid(s.first)&&s.second===undefined);
    await pool(todo,stats.secondConcurrency,async state=>{
      stats.secondRequests++;storeSample(state,'second',await probe(state.entry,2));stats.secondTested++;
      await emit(phase,stats.secondTested,firstPassed.length,stats.secondConcurrency);
    });
  }
  await emit('second-current',0,firstPassed.length,stats.secondConcurrency);
  await seconds(firstPassed.filter(s=>currentKeys.has(s.entry.key)),'second-current');
  const currentRows=Array.from(groups.values(),g=>best(g,true)).filter(Boolean).sort(compare);
  const retained=currentRows.slice(0,limit),currentIPs=new Set(currentRows.map(e=>e.ip));
  const otherGroups=Array.from(groups.values()).filter(g=>!currentIPs.has(g.ip));
  const available=limit-retained.length,explore=Math.floor(available/5),fast=available-explore;
  const knownOthers=()=>otherGroups.map(g=>best(g)).filter(Boolean).sort(compare);
  if(available>0) {
    const pending=otherGroups.flatMap(g=>g.states).filter(s=>lightValid(s.first)&&s.second===undefined)
      .sort((a,b)=>a.first.ms-b.first.ms||a.entry.key.localeCompare(b.entry.key));
    let offset=0;
    while(offset<pending.length) {
      const known=knownOthers(),cutoff=known.length>=fast?known[fast-1].lightLatency:Infinity;
      // max(first, second) cannot be smaller than first. Equality must still be
      // measured because the original key tie-break can change the shortlist.
      if(pending[offset].first.ms>cutoff)break;
      const batch=[];
      while(offset<pending.length&&batch.length<stats.secondConcurrency&&pending[offset].first.ms<=cutoff)batch.push(pending[offset++]);
      await seconds(batch,'second-latency');
    }
    const quick=knownOthers().slice(0,fast),quickIPs=new Set(quick.map(e=>e.ip));
    const otherIPs=new Set(otherGroups.map(g=>g.ip));
    const randomGroups=explorationOrder.filter(g=>otherIPs.has(g.ip)&&!quickIPs.has(g.ip));
    let cursor=0,found=0;
    while(cursor<randomGroups.length&&found<explore) {
      // Drain each bounded batch before selecting another. For a chosen IP,
      // inspect all remaining ports so its best valid endpoint is retained.
      const batch=randomGroups.slice(cursor,cursor+Math.min(stats.secondConcurrency,explore-found));cursor+=batch.length;
      await seconds(batch.flatMap(g=>g.states),'second-exploration');
      found+=batch.filter(g=>best(g)).length;
    }
    if(knownOthers().length<available) {
      // If fewer than the requested number can qualify, finish the remaining
      // first-pass candidates before recomputing both quotas from actual supply.
      await seconds(otherGroups.flatMap(g=>g.states),'second-exploration');
    }
  }
  const others=knownOthers(),supply=Math.min(available,others.length),exploreFinal=Math.floor(supply/5),fastFinal=supply-exploreFinal;
  const quickest=others.slice(0,fastFinal),fastIPs=new Set(quickest.map(e=>e.ip));
  const otherByIP=new Map(others.map(e=>[e.ip,e]));
  const random=explorationOrder.filter(g=>otherByIP.has(g.ip)&&!fastIPs.has(g.ip)).slice(0,exploreFinal).map(g=>otherByIP.get(g.ip));
  const downloads=retained.map(e=>({...e,downloadReason:'current'})).concat(quickest.map(e=>({...e,downloadReason:'latency'})),random.map(e=>({...e,downloadReason:'exploration'})));
  stats.allocation={current:retained.length,latency:quickest.length,exploration:random.length};
  stats.skippedSecond=firstPassed.length-stats.secondTested;stats.selectionComplete=true;
  await emit('second-complete',firstPassed.length,firstPassed.length,stats.secondConcurrency);
  return {rows:states.filter(s=>lightValid(s.first)&&lightValid(s.second)).map(row),downloads,stats};
}
async function execute(env,opts,pools,poolInfo=null) {
  const samplingPools=pools,official=poolInfo?poolInfo.official:[];
  pools=pools.concat(official);
  const mode=MODES[opts.mode]; const runId=env.id(); const start=env.now(); let publishing=false;
  const progress={version:1,runId,host:opts.host,mode:opts.mode,startedAt:start,updatedAt:start,stage:'准备',done:0,total:0,bytes:0};
  const initialNetwork=env.networkKey();
  const timings={};let timingStage='准备',timingStart=start;
  function timingSnapshot(){return {...timings,[timingStage]:(timings[timingStage]||0)+Math.max(0,env.now()-timingStart)};}
  async function update(stage,done,total){
    if(stage!==timingStage){Object.assign(timings,timingSnapshot());timingStage=stage;timingStart=env.now();}
    Object.assign(progress,{stage,done,total,updatedAt:env.now(),stageTimings:timingSnapshot()});await env.progress(progress);
  }
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
  let done=0;
  async function connect(e,target) {
    await guard();
    const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:target==='gstatic'?'HEAD':'GET',url:target==='gstatic'?'http://www.gstatic.com/generate_204':'https://www.youtube.com/generate_204',timeout:4,headers:{'Cache-Control':'no-cache','Connection':'close'}});
    return {valid:!r.error&&r.status===204,ms:r.ms,status:r.status||0};
  }
  progress.lightRequests=0;
  const light=await selectiveLightScreen(entries,baseline.entries,opts.limit,LIGHT_SCREEN[opts.mode],async(e,pass)=>{
    await guard();progress.lightRequests++;
    const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:'HEAD',
      url:'http://www.gstatic.com/generate_204?cf_rank_light='+runId+'-p'+pass+'-'+env.id(),timeout:LIGHT_SCREEN[opts.mode].timeout,
      headers:{'Cache-Control':'no-cache','Connection':'close'}});
    await guard();return {error:r.error||null,status:r.status||0,ms:r.ms};
  },async p=>{
    progress.lightConcurrency=p.concurrency;progress.lightScreen=p.stats;
    await update(p.phase.startsWith('second-')?'轻量候选二次复核':p.rechecking?'轻量初筛降载复核':'低流量连通与延迟初筛',p.done,p.total);
  },env.random);
  assert(light.stats.secondPassed>=10,'可连接候选不足 10 个，保留原订阅');
  const downloadEntries=light.downloads;
  assert(downloadEntries.length>=10,'有效下载候选不足 10 个，保留原订阅');
  progress.downloadCandidateCount=downloadEntries.length;
  progress.premium={tested:0,eligible:0,passed:0,unavailable:0,unknown:0,inconsistent:0,verified:0,refreshed:0,recoveryAttempts:0,recovered:0,bytes:0,
    preflight:{total:downloadEntries.length,tested:0,passed:0,unavailable:0,unknown:0,skippedDownloads:0,reused:0,refreshed:0}};
  progress.premiumFinalFailures=[];
  // Each download candidate must establish Premium availability before even
  // the small Range download. Keep one sample; finalists complete the pair
  // before full downloads, then still need the final publication check.
  const preflight=new Array(downloadEntries.length);
  await update('下载前 Premium 首检',0,downloadEntries.length);
  await pool(downloadEntries,4,async(e,index)=>{
    const sample=await premiumProbe(e),stats=progress.premium.preflight;
    stats.tested++;
    if(sample.status==='available'){
      stats.passed++;preflight[index]={...e,premiumInitial:sample};
    } else {
      stats[sample.status==='unavailable'?'unavailable':'unknown']++;stats.skippedDownloads++;
    }
    await update('下载前 Premium 首检',stats.tested,downloadEntries.length);
  });
  const premiumEntries=preflight.filter(Boolean);
  assert(premiumEntries.length>=10,'Premium 首检合格 '+premiumEntries.length+'/10，不足 10 个，未开始下载测速，保留原订阅');
  progress.downloadTestedCount=premiumEntries.length;
  async function download(e,size,seconds) {
    await guard(); const offset=Math.floor(env.random()*150000000);
    const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:'GET',url:'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg?cf_rank='+runId+'-'+env.id(),timeout:seconds,binary:true,
      headers:{Range:'bytes='+offset+'-'+(offset+size-1),'Accept-Encoding':'identity','Cache-Control':'no-cache'}});
    progress.bytes+=r.bytes||0;
    assert(r.status!==200,'下载源未遵守 Range，已停止，保留原订阅');
    return downloadValid(r,offset,size);
  }
  done=0;const screened=[];await update('下载初筛',0,premiumEntries.length);
  await pool(premiumEntries,3,async e=>{const d=await download(e,mode.screenBytes,5);if(d.valid)screened.push({...e,valid:true,score:d.mbps});await update('下载初筛',++done,premiumEntries.length);});
  const finalists=topDistinct(screened,mode.finalists);
  assert(finalists.length>=10,'有效下载候选不足 10 个，保留原订阅');
  const selected=[],reserveRanking=[],pending=[],rejectedIPs=new Set(),observed=new Map(),initialFinalIPs=new Set();
  progress.refinement={initialCandidates:0,firstSamples:0,secondSamples:0,skippedInvalidFirst:0,skippedByBound:0,
    reserveFirstSamples:0,reserveSecondSamples:0,reserveSkippedInvalidFirst:0,savedSecondSamples:0};
  async function stableOne(e) {
    const checks=[];
    for(let n=0;n<3;n++) {
      checks.push(await connect(e,'gstatic'));if(!checks[checks.length-1].valid)break;
      checks.push(await connect(e,'youtube'));if(!checks[checks.length-1].valid)break;
    }
    await guard();
    return {...e,checks,valid:checks.length===6&&checks.every(x=>x.valid),latency:median(checks.map(x=>x.ms))};
  }
  async function refineReserve(e) {
    const samples=[await download(e,mode.sampleBytes,8)];progress.refinement.reserveFirstSamples++;
    if(samples[0].valid){samples.push(await download(e,mode.sampleBytes,8));progress.refinement.reserveSecondSamples++;}
    else {progress.refinement.reserveSkippedInvalidFirst++;progress.refinement.savedSecondSamples++;}
    await guard();
    return {...e,valid:samples.length===2&&samples.every(x=>x.valid),score:Math.min(...samples.map(x=>x.mbps)),samples};
  }
  async function premiumProbe(e) {
    const result=await premium.probe(env,descriptor(e,baseline.cfg),guard);
    progress.premium.bytes+=result.bytes;
    return result;
  }
  async function premiumPair(e,reuseInitial=false) {
    const initial=reuseInitial&&e.premiumInitial;
    const fresh=initial&&initial.status==='available'&&initial.reason==='full_premium_offer'&&
      Number.isFinite(initial.checkedAt)&&initial.checkedAt<=env.now()&&env.now()-initial.checkedAt<=premium.MAX_AGE/2;
    if(initial)progress.premium.preflight[fresh?'reused':'refreshed']++;
    const samples=[fresh?initial:await premiumProbe(e)];
    if(samples[0].status==='available')samples.push(await premiumProbe(e));
    const available=samples.length===2&&samples.every(s=>s.status==='available')&&samples[0].region===samples[1].region&&
      (!initial||samples[0].region===initial.region);
    const status=available?'available':samples.some(s=>s.status==='unavailable')?'unavailable':samples.every(s=>s.status==='available')?'inconsistent':'unknown';
    return {status,region:available?samples[0].region:null,samples};
  }
  async function checkCandidate(e) {
    const result=await premiumPair(e,true);
    progress.premium.tested++;
    if(result.status!=='available')progress.premium[result.status]++;
    return result;
  }
  async function qualifyingBatch(rows,stage,offset=0,total=rows.length) {
    const checked=new Array(rows.length);let done=0;
    await update(stage,offset,total);
    await pool(rows,4,async(e,i)=>{
      const result=await checkCandidate(e);
      if(result.status==='available') {
        progress.premium.eligible++;
        checked[i]=await stableOne({...e,premium:result});
      }
      await update(stage,offset+(++done),total);
    });
    return checked.filter(Boolean);
  }
  // Four workers keep each node's Premium and stability requests sequential.
  // The entire pool drains before any full bandwidth measurement starts.
  const stable=(await qualifyingBatch(finalists,'Premium 与稳定性检查')).filter(e=>e.valid);
  progress.refinement.initialCandidates=stable.length;
  const first=[],ranking=new Array(stable.length);done=0;await update('下载复测首轮',0,stable.length);
  for(let index=0;index<stable.length;index++) {
    const e=stable[index],sample=await download(e,mode.sampleBytes,8);await guard();
    progress.refinement.firstSamples++;
    if(sample.valid)first.push({e,sample,index});
    else {progress.refinement.skippedInvalidFirst++;progress.refinement.savedSecondSamples++;}
    await update('下载复测首轮',++done,stable.length);
  }
  // min(first, second) cannot exceed first. Measure the most promising bounds
  // first, retaining equal-score candidates for the original latency tie-break.
  first.sort((a,b)=>b.sample.mbps-a.sample.mbps||a.index-b.index);
  done=0;await update('下载复测决选',0,first.length);
  for(const {e,sample,index} of first) {
    await guard();
    const leaders=topDistinct(ranking.filter(Boolean),10);
    if(leaders.length===10&&sample.mbps<leaders[9].score) {
      progress.refinement.skippedByBound++;progress.refinement.savedSecondSamples++;
      pending.push({e,sample,index});
    } else {
      const second=await download(e,mode.sampleBytes,8);await guard();progress.refinement.secondSamples++;
      const samples=[sample,second];
      // Index storage preserves the original order for exact speed/latency ties.
      ranking[index]={...e,valid:second.valid,score:Math.min(sample.mbps,second.mbps),samples};
      progress.premium.passed=Math.min(10,ranking.filter(e=>e&&e.valid).length);
    }
    await update('下载复测决选',++done,first.length);
  }
  selected.push(...topDistinct(ranking.filter(Boolean),10));
  const finalistIPs=new Set(finalists.map(e=>e.ip));
  const reserves=topDistinct(screened,screened.length).filter(e=>!finalistIPs.has(e.ip));
  progress.supplement={available:reserves.length,examined:0,eligible:0,refined:0,added:0,failedRefine:0,limit:mode.reserveFinalists,limited:false};
  let nextReserve=0;
  function selectRanking() {
    selected.splice(0,selected.length,...topDistinct(ranking.filter(Boolean).concat(reserveRanking).filter(e=>!rejectedIPs.has(e.ip)),10));
    progress.premium.passed=selected.length;
    progress.premium.verified=selected.filter(e=>observed.has(e.ip)&&premium.qualified(observed.get(e.ip).premium,env.now())).length;
    if(progress.finalSelection)progress.finalSelection.replacements=selected.filter(e=>!initialFinalIPs.has(e.ip)&&observed.has(e.ip)&&premium.qualified(observed.get(e.ip).premium,env.now())).length;
  }
  async function supplement() {
    while(selected.length<10&&nextReserve<reserves.length) {
      await guard();
      if(progress.supplement.refined>=mode.reserveFinalists){progress.supplement.limited=true;await update('后备 Premium 与稳定性检查',progress.supplement.examined,reserves.length);break;}
      const size=Math.min(4,10-selected.length,mode.reserveFinalists-progress.supplement.refined);
      const batch=reserves.slice(nextReserve,nextReserve+size);nextReserve+=batch.length;
      const checked=await qualifyingBatch(batch,'后备 Premium 与稳定性检查',progress.supplement.examined,reserves.length);
      progress.supplement.examined+=batch.length;progress.supplement.eligible+=checked.length;
      progress.supplement.refined+=checked.length;
      progress.supplement.failedRefine+=checked.filter(e=>!e.valid).length;
      const ready=checked.filter(e=>e.valid);let done=0;
      await update('后备节点速度复测',0,ready.length);
      for(const e of ready) {
        const row=await refineReserve(e);
        if(row.valid){reserveRanking.push(row);progress.supplement.added++;}
        else progress.supplement.failedRefine++;
        selectRanking();
        await update('后备节点速度复测',++done,ready.length);
      }
      await update('后备 Premium 与稳定性检查',progress.supplement.examined,reserves.length);
    }
  }
  await supplement();
  assert(selected.length===10 && new Set(selected.map(x=>x.ip)).size===10,
    'Premium 合格 '+selected.length+'/10，'+(progress.supplement.limited?'补选复测达到上限':'后备候选已用尽')+'，不足 10 个，保留原订阅');
  selectRanking();
  selected.forEach(e=>initialFinalIPs.add(e.ip));
  const geoCache=new Map();
  progress.finalSelection={rounds:0,examined:0,rejected:0,expired:0,replacementChecks:0,replacements:0,resumedDownloads:0};
  let lastFinalError=null;
  function failureText(issue) {
    const labels={network_timeout:'请求超时',network:'连接失败',region_unavailable:'所在地区明确不支持 Premium',
      challenge:'遇到验证或同意页面',body:'响应正文不完整或异常',page_format:'无法识别页面结构',
      region_unknown:'无法确认地区',country_unverified:'YouTube 无法验证出口国家',no_full_premium_offer:'页面未确认完整 Premium 服务',
      region_changed:'地区前后不一致',expired:'检测记录已超过 10 分钟',future_time:'检测时间晚于当前时间',
      invalid_time:'检测时间无效',incomplete:'检测记录不完整'};
    return issue.reason==='http'?'HTTP 请求未成功（'+(issue.httpStatus||'未知')+'）':labels[issue.reason]||'检测结果无法确认';
  }
  async function recordFinalFailure(row,index,phase,issue,attempt='initial') {
    const diagnostic={candidate:index+1,endpoint:row.key,phase,attempt,...issue,recoveryAttempted:attempt==='recovery',recovered:false};
    progress.premiumFinalFailures.push(diagnostic);
    lastFinalError=finalError(index,phase,issue,attempt==='recovery');
    await update('出口与 Premium 最终复核',progress.premium.verified,10);
    return diagnostic;
  }
  function finalError(index,phase,issue,recovery=false) {
    return new Error('候选 '+(index+1)+' · Premium '+(phase==='refresh'?'更新检测':'发布前复核')+
      '未通过：'+(recovery?'恢复三检失败，':'')+failureText(issue)+'，保留原订阅');
  }
  async function finishPremium(row,index) {
    row.premium.samples.push(await premiumProbe(row));
    const issue=premium.failure(row.premium,env.now());
    if(!issue)return true;
    const diagnostic=await recordFinalFailure(row,index,'final',issue);
    if(!issue.retryable)return false;
    // One bounded recovery is permitted only for an unambiguous third-sample
    // transport failure. Old evidence is not reused in the replacement trio.
    diagnostic.recoveryAttempted=true;progress.premium.recoveryAttempts++;
    await update('出口与 Premium 最终复核',progress.premium.verified,10);
    await guard();await env.sleep(1000);await guard();
    const replacement={status:'available',region:row.premium.region,samples:[]};
    for(let attempt=0;attempt<3;attempt++) {
      const sample=await premiumProbe(row);replacement.samples.push(sample);
      const problem=premium.failure(replacement,env.now());
      const sampleValid=sample.status==='available'&&sample.reason==='full_premium_offer'&&sample.region===replacement.region&&
        Number.isFinite(sample.checkedAt)&&sample.checkedAt<=env.now()&&env.now()-sample.checkedAt<=premium.MAX_AGE;
      // Healthy partial trios are expected while collecting the first two.
      // Any real failure, including a different previously confirmed country,
      // stops immediately; this recovery is never recursively retried.
      if(problem&&(!sampleValid||problem.reason!=='incomplete'||attempt===2)) {
        await recordFinalFailure(row,index,'final',problem,'recovery');
        return false;
      }
    }
    row.premium=replacement;diagnostic.recovered=true;progress.premium.recovered++;
    await update('出口与 Premium 最终复核',progress.premium.verified,10);
    return true;
  }
  function rejectFinal(e) {
    if(!rejectedIPs.has(e.ip)){rejectedIPs.add(e.ip);progress.finalSelection.rejected++;}
    for(const diagnostic of progress.premiumFinalFailures)if(diagnostic.endpoint===e.key&&!diagnostic.recovered)diagnostic.discarded=true;
    observed.delete(e.ip);selectRanking();
  }
  async function resumeCompetitiveDownloads() {
    // Previously pruned first samples are bounds, not measured fallback scores.
    // Removing a finalist can lower the cutoff: finish every newly competitive
    // second sample (including ties) before admitting a lower-ranked reserve.
    while(pending.length) {
      await guard();selectRanking();
      const {e,sample,index}=pending[0];
      if(selected.length===10&&sample.mbps<selected[9].score)break;
      pending.shift();
      await update('补位第二次下载',progress.finalSelection.resumedDownloads,progress.finalSelection.resumedDownloads+1);
      const second=await download(e,mode.sampleBytes,8);await guard();
      progress.refinement.secondSamples++;progress.refinement.skippedByBound--;progress.refinement.savedSecondSamples--;
      progress.finalSelection.resumedDownloads++;
      ranking[index]={...e,valid:second.valid,score:Math.min(sample.mbps,second.mbps),samples:[sample,second]};
      selectRanking();
      await update('补位第二次下载',progress.finalSelection.resumedDownloads,progress.finalSelection.resumedDownloads);
    }
  }
  // A failed node is removed for this run, rather than repeatedly probing it
  // until it passes or throwing away every healthy candidate. Each candidate
  // reaches final validation once; a confirmed trio that expires is also
  // removed. Cancellation, ownership/network errors and backend conflicts still
  // abort the run. Reserve retests share the existing 24-candidate budget.
  for(;;) {
    await guard();selectRanking();
    for(const [index,e] of selected.slice().entries()) {
      const prior=observed.get(e.ip);
      if(prior&&!premium.qualified(prior.premium,env.now())) {
        await recordFinalFailure(prior,index,'final',premium.failure(prior.premium,env.now()));
        progress.finalSelection.expired++;rejectFinal(e);
      }
    }
    await resumeCompetitiveDownloads();await supplement();selectRanking();
    assert(selected.length===10,(lastFinalError?lastFinalError.message+'；':'')+
      '复核补位不足 10 个（有效下载候选 '+selected.length+'/10，'+(progress.supplement.limited?'已达共享补选上限':'本轮候选已用尽')+'），保留原订阅');
    const targets=selected.map((e,index)=>({e,index})).filter(({e})=>!observed.has(e.ip));
    if(!targets.length) {
      if(selected.every(e=>premium.qualified(observed.get(e.ip).premium,env.now())))break;
      continue; // A previously confirmed row may have expired during a download.
    }
    progress.finalSelection.rounds++;
    await update('出口与 Premium 最终复核',progress.premium.verified,10);
    await pool(targets,4,async({e,index})=>{
      progress.finalSelection.examined++;
      if(!initialFinalIPs.has(e.ip))progress.finalSelection.replacementChecks++;
      const row={...e,premium:{...e.premium,samples:e.premium.samples.slice()},egress:await exitCountry(env,e,baseline.cfg,guard,geoCache)};
      if(row.premium.samples.some(s=>env.now()-s.checkedAt>premium.MAX_AGE/2)) {
        const result=await premiumPair(row);
        if(result.status!=='available') {
          await recordFinalFailure(row,index,'refresh',premium.failure(result,env.now()));
          rejectFinal(e);await update('出口与 Premium 最终复核',progress.premium.verified,10);return;
        }
        row.premium=result;progress.premium.refreshed++;
      }
      if(await finishPremium(row,index))observed.set(e.ip,row);else rejectFinal(e);
      selectRanking();await update('出口与 Premium 最终复核',progress.premium.verified,10);
    });
  }
  const expectedNames=namedEntries(selected.map(e=>observed.get(e.ip)));
  const proposed=expectedNames.map(e=>e.key+'#'+e.name).join('\n');
  await guard();await update('发布前核对',0,1);
  const fresh=await snapshot();
  assert(fresh.cfg.fingerprint===baseline.cfg.fingerprint&&fresh.list===baseline.list,'测速期间后台被改动，已保留当前设置');
  assert(sameEntries(await raw(fresh.cfg),baseline.entries),'测速期间实际订阅已改变，跳过发布');
  await guard();
  assert(expectedNames.every(e=>premium.qualified(e.premium,env.now())),'Premium 检测结果已过期，保留原订阅');
  const outcome={runId,startedAt:start,finishedAt:env.now(),host:opts.host,mode:opts.mode,candidateCount:entries.length,reachable:light.stats.secondPassed,screened:screened.length,finalists:finalists.length,bytes:progress.bytes,premium:{...progress.premium},selected:expectedNames.map(({ip,port,key,name,egress,premium,score,latency,samples})=>({ip,port,key,name,egress,premium,score,latency,samples})),changed:false,verified:false};
  outcome.supplement={...progress.supplement};
  outcome.finalSelection={...progress.finalSelection};
  outcome.premiumFinalFailures=progress.premiumFinalFailures.map(d=>({...d,regions:d.regions.slice()}));
  outcome.refinement={...progress.refinement};
  outcome.lightScreen=light.stats;
  function finishOutcome(){outcome.stageTimings=timingSnapshot();outcome.finishedAt=env.now();return outcome;}
  outcome.poolInfo=poolInfo;
  outcome.candidateSources=entries.reduce((counts,e)=>{counts[e.candidateSource]=(counts[e.candidateSource]||0)+1;return counts;},{});
  outcome.lightRequests=progress.lightRequests;
  outcome.downloadCandidateCount=downloadEntries.length;
  outcome.downloadTestedCount=premiumEntries.length;
  outcome.downloadReasons=downloadEntries.reduce((counts,e)=>{counts[e.downloadReason]=(counts[e.downloadReason]||0)+1;return counts;},{});
  outcome.downloadCandidates=downloadEntries.map(({ip,port,key,lightLatency,downloadReason})=>({ip,port,key,lightLatency,downloadReason}));
  async function verify(cfg,expected) {
    const a=await raw(cfg);
    const b=parseSurge(await req('GET','/sub?token='+cfg.token+'&surge'),cfg,pools);
    return sameNamedEntries(a,expected)&&sameNamedEntries(b,expected);
  }
  if(baseline.list.trim()===proposed) { outcome.verified=await verify(fresh.cfg,expectedNames);assert(outcome.verified,'列表未变，但订阅转换未核对通过');return finishOutcome(); }
  try {
    publishing=true;await update('保存与订阅验证',0,1);
    await guard();assert(expectedNames.every(e=>premium.qualified(e.premium,env.now())),'Premium 检测结果已过期，保留原订阅');
    try {
      const response=await req('POST','/admin/ADD.txt',proposed);
      assert(response&&response.success===true,'后台未确认保存成功');
    } catch(error) {
      // A lost response does not prove the write failed. Read back first;
      // never blindly repeat a POST that may already have been applied.
      if(!error.controlFailure||!error.controlFailure.uncertain)throw error;
      const check=await snapshot();
      if(check.cfg.fingerprint!==baseline.cfg.fingerprint||check.list.trim()!==proposed)throw error;
    }
    outcome.changed=true;
    for(const wait of [0,3000,12000,30000,60000]) {
      if(wait)await env.sleep(wait);
      const check=await snapshot();
      if(check.cfg.fingerprint!==baseline.cfg.fingerprint)throw new Error('保存后后台连接参数发生变化');
      if(check.list.trim()===proposed && await verify(check.cfg,expectedNames)) {outcome.verified=true;break;}
    }
    assert(outcome.verified,'订阅传播后仍未核对通过');
    outcome.publishedAt=env.now();await update('完成，订阅已验证',1,1);return finishOutcome();
  } catch(error) {
    let rollback='未覆盖其他修改';
    try {
      const check=await snapshot();
      if(check.cfg.fingerprint===baseline.cfg.fingerprint && check.list.trim()===proposed) {
        const restored=await req('POST','/admin/ADD.txt',baseline.list);
        rollback=restored&&restored.success===true?'已请求恢复备份，需检查订阅传播':'恢复备份未获确认';
      }
    } catch(_) {rollback='无法确认恢复，请检查后台';}
    throw new Error('发布验证失败；'+(error.controlFailure?error.message+'；':'')+rollback);
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
const api={MODES,LIGHT_SCREEN,settings,ipNumber,numberIP,inPools,endpoint,parseList,includeCurrent,base64Decode,configGuard,parseRaw,parseSurge,sameEntries,sameNamedEntries,namedEntries,countryFlag,publicIPv4,exitCountry,candidates,descriptor,downloadValid,topDistinct,scanCount,lightValid,adaptiveLightScreen,pickDownloads,selectiveLightScreen,execute,renameOnly};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFRankCore=api;
})(typeof globalThis==='object'?globalThis:this);
