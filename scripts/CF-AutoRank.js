// CF AutoRank v0.1.23. Credentials are entered by the user; never bundle secrets.
(function(root) {
'use strict';
const MAX_HTML=2500000;
const MAX_AGE=10*60*1000;
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// Parse the public landing page as data only. Never execute downloaded JavaScript.
function initialData(html) {
  const marker=/(?:\b(?:var|let|const)\s+)?\bytInitialData\s*=\s*|window\s*\[\s*["']ytInitialData["']\s*\]\s*=\s*/g;
  const match=marker.exec(html);if(!match)return null;
  const start=marker.lastIndex;if(html[start]!=='{')return null;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<html.length;i++) {
    const c=html[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1));}catch(_){return null;}}
  }
  return null;
}
function objects(value) {
  const out=[],queue=[value];
  // Size/depth limits turn unfamiliar or pathological page formats into unknown.
  while(queue.length&&out.length<20000) {
    const v=queue.pop();if(!v||typeof v!=='object')continue;
    out.push(v);for(const child of Object.values(v))if(child&&typeof child==='object')queue.push(child);
  }
  return queue.length?[]:out;
}
function utf8Bytes(value) {
  let n=0;
  for(const ch of String(value||'')){const c=ch.codePointAt(0);n+=c<128?1:c<2048?2:c<65536?3:4;}
  return n;
}
function classify(response) {
  const result=(status,reason,region=null)=>({status,reason,region});
  if(!response||response.error)return result('unknown','network');
  if(response.status!==200)return result('unknown','http');
  const html=response.data;
  if(typeof html!=='string'||!html.length||html.length>MAX_HTML)return result('unknown','body');
  if(/our systems have detected unusual traffic|before you continue to (?:YouTube|Google)|id=["']captcha-form/i.test(html))return result('unknown','challenge');
  const data=initialData(html);
  if(!data||!data.contents)return result('unknown','page_format');
  const rows=objects(data.contents);if(!rows.length)return result('unknown','page_format');
  const text=rows.flatMap(v=>['text','content','simpleText','label'].map(k=>typeof v[k]==='string'?v[k]:'')).join('\n');
  if(/(?:YouTube\s+)?Premium\s+(?:is\s+)?(?:not(?:\s+yet)?\s+available|unavailable)\s+in\s+your\s+(?:country|region)/i.test(text))return result('unavailable','region_unavailable');
  if(/(?:couldn[’']t|cannot|can[’']t)\s+verify\s+your\s+country/i.test(text))return result('unknown','country_unverified');
  const regions=Array.from(html.matchAll(/"INNERTUBE_CONTEXT_GL"\s*:\s*"([A-Z]{2})"/g)).map(m=>m[1]);
  if(!regions.length||new Set(regions).size!==1||['AA','XX','ZZ'].includes(regions[0]))return result('unknown','region_unknown');
  // The full-Premium offer must have a price and an active purchase action.
  // Generic marketing, sign-in links, and Premium Lite alone are insufficient.
  const offer=rows.some(v=>{
    const o=v.lpOfferCardOptionViewModel;if(!o)return false;
    const b=o.purchaseButtonOverride&&o.purchaseButtonOverride.buttonViewModel;
    if(!b||b.state!=='BUTTON_VIEW_MODEL_STATE_ACTIVE'||!/\d/.test(o.title&&o.title.content||''))return false;
    return objects(b.onTap).some(x=>{
      const e=x.browseEndpoint;
      return e&&e.browseId==='SPunlimited'&&e.canonicalBaseUrl==='/premium'&&typeof e.params==='string'&&e.params.length>0;
    });
  });
  return offer?result('available','full_premium_offer',regions[0]):result('unknown','no_full_premium_offer',regions[0]);
}
function httpStatus(value) {return Number.isInteger(value)&&value>=100&&value<=599?value:0;}
function networkError(value) {return value==='timeout'||value==='connection'?value:null;}
async function probe(env,descriptor,guard) {
  await guard();
  const r=await env.probe({descriptor,method:'GET',
    url:'https://www.youtube.com/premium?hl=en&cf_rank_premium='+env.id(),timeout:8,
    headers:{'User-Agent':UA,Accept:'text/html','Accept-Language':'en-US,en;q=0.9','Cache-Control':'no-cache','Connection':'close'}});
  await guard();
  const response=r||{};
  // Keep diagnostic codes only: never retain the raw error, response HTML,
  // descriptor, headers, or URL in a result that may be copied or persisted.
  const transport=response.error?(/timeout|timed out|超时/i.test(String(response.error))?'timeout':'connection'):null;
  return {...classify(r),checkedAt:env.now(),bytes:typeof response.data==='string'?utf8Bytes(response.data):Number(response.bytes)||0,
    httpStatus:httpStatus(response.status),networkError:transport,
    durationMs:Number.isFinite(response.ms)&&response.ms>0?response.ms:1};
}
function qualified(value,now) {
  return !!value&&value.status==='available'&&/^[A-Z]{2}$/.test(value.region||'')&&Array.isArray(value.samples)&&value.samples.length===3&&value.samples.every(s=>
    s.status==='available'&&s.reason==='full_premium_offer'&&s.region===value.region&&
    Number.isFinite(s.checkedAt)&&s.checkedAt<=now&&now-s.checkedAt<=MAX_AGE);
}
function failure(value,now) {
  const samples=value&&Array.isArray(value.samples)?value.samples:[];
  if(samples.every(s=>s&&typeof s==='object')&&qualified(value,now))return null;
  const region=v=>typeof v==='string'&&/^[A-Z]{2}$/.test(v)?v:null;
  const expected=region(value&&value.region),regions=samples.slice(0,3).map(s=>region(s&&s.region));
  const ages=samples.filter(s=>s&&Number.isFinite(s.checkedAt)&&Number.isFinite(now-s.checkedAt)).map(s=>Math.max(0,now-s.checkedAt));
  const oldestAgeMs=ages.length?Math.max(...ages):null;
  const fresh=s=>s&&Number.isFinite(now)&&Number.isFinite(s.checkedAt)&&s.checkedAt<=now&&now-s.checkedAt<=MAX_AGE;
  const valid=s=>fresh(s)&&s.status==='available'&&s.reason==='full_premium_offer'&&s.region===expected;
  const result=(reason,index=null)=>{
    const s=index===null?null:samples[index],status=httpStatus(s&&s.httpStatus),transport=networkError(s&&s.networkError);
    // Only a clearly identified third transport failure can be recovered. An
    // HTTP rejection, old evidence, or a changed country must not be retried
    // until it happens to look acceptable.
    const retryable=['network_timeout','network'].includes(reason)&&index===2&&samples.length===3&&
      value&&value.status==='available'&&!!expected&&samples.slice(0,2).every(valid)&&fresh(s)&&
      s.status==='unknown'&&s.reason==='network'&&!!transport&&(!s.region||s.region===expected)&&[0,200].includes(status);
    return {reason,index,httpStatus:status,networkError:transport,regions,oldestAgeMs,retryable:!!retryable};
  };
  if(!Number.isFinite(now))return result('invalid_time');
  if(samples.length>3)return result('incomplete');
  // Evidence freshness and differing observed countries take precedence over
  // a simultaneous network error, so retryability cannot mask those failures.
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];if(!s)continue;
    if(Number.isFinite(s.checkedAt)) {
      if(s.checkedAt>now)return result('future_time',i);
      if(now-s.checkedAt>MAX_AGE)return result('expired',i);
    } else if(s.status==='available')return result('invalid_time',i);
  }
  const available=samples.map((s,index)=>({s,index})).filter(({s})=>s&&s.status==='available');
  const firstRegion=expected||region(available[0]&&available[0].s.region);
  for(const {s,index} of available) {
    if(!region(s.region))return result('region_unknown',index);
    if(firstRegion&&s.region!==firstRegion)return result('region_changed',index);
  }
  const permanent=['region_unavailable','country_unverified','challenge','body','page_format','region_unknown','no_full_premium_offer'];
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];if(!s)continue;
    if(s.status==='unavailable')return result('region_unavailable',i);
    if(permanent.includes(s.reason))return result(s.reason,i);
  }
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];if(s&&s.reason==='http')return result('http',i);
  }
  for(let i=0;i<samples.length;i++) {
    const s=samples[i];
    if(s&&s.reason==='network')return result(networkError(s.networkError)==='timeout'?'network_timeout':'network',i);
  }
  if(samples.length!==3)return result('incomplete');
  if(!expected)return result('region_unknown');
  const invalid=samples.findIndex(s=>!valid(s));
  return result('incomplete',invalid>=0?invalid:null);
}
const api={MAX_AGE,MAX_HTML,initialData,classify,probe,qualified,failure,utf8Bytes};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFYouTubePremium=api;
})(typeof globalThis==='object'?globalThis:this);

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
  const rangeOK=!!match&&Number(match[1])===start&&Number(match[2])===end&&Number(match[3])>end;
  const valid=result.status===206&&rangeOK&&
    bytes>=Math.min(65536,size)&&bytes<=size&&(!result.error||timed)&&result.ms>0&&(!result.error?bytes===size:true);
  const reason=valid?null:result.status&&result.status!==206?'http':result.status===206&&!rangeOK?'range':
    timed&&!bytes?'timeout_empty':result.error&&!timed?
    (/response size limit/.test(String(result.error))?'size_limit':'network'):result.status!==206?'http':
    bytes>size?'oversize':!bytes?'empty_body':bytes<Math.min(65536,size)?'too_small':
    !result.error&&bytes!==size?'truncated':!(result.ms>0)?'timing':'invalid';
  return {valid:!!valid,bytes,ms:result.ms,status:result.status||0,partial:!!valid&&bytes<size,
    mbps:valid?Number((bytes*8/result.ms/1000).toFixed(3)):0,reason,timedOut:timed};
}
// A single timed-out $httpClient request may return no headers or partial body.
// Full mode retains completed 2 MB ranges within one 8 MB / 8 s sample window.
// Failed tails are never estimated; their time still lowers the sample score.
async function chunkedDownload(request,size,seconds,chunkSize,now,guard) {
  const start=now(),budgetMs=seconds*1000;
  let bytes=0,requestMs=0,last=null,reason=null,termination='complete';
  const chunks={attempted:0,complete:0,partial:0,emptyTimeouts:0};
  const elapsed=()=>Math.max(0,now()-start,requestMs);
  while(bytes<size) {
    await guard();
    const remaining=Math.floor((budgetMs-elapsed())/1000);
    if(remaining<1){termination='deadline';break;}
    const partSize=Math.min(chunkSize,size-bytes);
    last=await request(partSize,remaining);await guard();
    chunks.attempted++;bytes+=last.bytes;requestMs+=last.ms||0;
    if(!last.valid) {
      if(last.reason==='timeout_empty')chunks.emptyTimeouts++;
      if(last.reason==='timeout_empty'&&bytes>=Math.min(65536,size)){
        termination='timeout';break;
      }
      reason=last.reason;termination='failed';break;
    }
    if(last.partial){chunks.partial++;termination='timeout';break;}
    chunks.complete++;
  }
  const ms=elapsed(),valid=!reason&&bytes>=Math.min(65536,size)&&bytes<=size&&ms>0;
  if(!valid&&!reason)reason=last&&last.reason||'empty_body';
  return {valid,bytes,ms,status:valid?206:last&&last.status||0,lastStatus:last&&last.status||0,
    partial:valid&&bytes<size,mbps:valid?Number((bytes*8/ms/1000).toFixed(3)):0,
    reason,termination,chunks,requestedBytes:size};
}
async function pool(items,n,fn) {
  let i=0,failure=null,failed=false;
  await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{
    while(i<items.length&&!failed){const index=i++;try{await fn(items[index],index);}catch(error){if(!failed){failed=true;failure=error||new Error('并发请求处理异常');}}}
  }));
  if(failed)throw failure;
}
// Ordered admission without batch barriers. Items are dispatched in order to
// at most `width` workers; an item starts only while accepted + undecided <
// needed, so every accepted item is among the first `needed` acceptances in
// order and nothing beyond them is examined. An accepted item continues with
// `rest` in the same worker, keeping each item's requests sequential.
async function rankedPipeline(items,width,needed,first,rest=async()=>{}) {
  let cursor=0,pending=0,accepted=0,failed=false,failure=null;const waiting=[];
  const wake=()=>{while(waiting.length)waiting.shift()();};
  const fail=error=>{if(!failed){failed=true;failure=error||new Error('并发请求处理异常');}wake();};
  async function worker() {
    while(!failed&&cursor<items.length) {
      if(accepted+pending>=needed){if(!pending)return;await new Promise(resolve=>waiting.push(resolve));continue;}
      const index=cursor++;pending++;let value=null;
      try{value=await first(items[index],index);}catch(error){fail(error);}
      finally{pending--;if(value&&!failed)accepted++;wake();}
      if(failed)return;
      if(value){try{await rest(items[index],index,value);}catch(error){fail(error);return;}}
    }
  }
  await Promise.all(Array.from({length:Math.min(width,items.length)},worker));
  if(failed)throw failure;
  return accepted;
}
// Like pool(), but an item starts only while gate(item, active) allows it.
// A closed gate waits for an in-flight item to finish and re-checks; with
// nothing in flight it ends the pool. There is no batch barrier.
async function gatedPool(items,width,gate,fn) {
  let cursor=0,active=0,failed=false,failure=null;const waiting=[];
  const wake=()=>{while(waiting.length)waiting.shift()();};
  async function worker() {
    while(!failed&&cursor<items.length) {
      let open=false;
      try{open=gate(items[cursor],active);}catch(error){if(!failed){failed=true;failure=error;}wake();return;}
      if(!open){if(!active)return;await new Promise(resolve=>waiting.push(resolve));continue;}
      const index=cursor++;active++;
      try{await fn(items[index],index);}catch(error){if(!failed){failed=true;failure=error||new Error('并发请求处理异常');}}
      finally{active--;wake();}
    }
  }
  await Promise.all(Array.from({length:Math.min(width,items.length)},worker));
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
  let sampleVersion=0;
  function storeSample(state,field,sample) {
    sampleVersion++;
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
  // First pass without batch barriers. Batches keep their own width and are
  // still evaluated one by one, but when a batch is down to its slow tail the
  // idle slots start the next batch. Every request starts only while the total
  // in flight is below the width of each batch that still has requests out, so
  // no entry is measured above its own batch's width. The next batch's width is
  // raised once the previous batch has been judged healthy. If a batch at a
  // raised width degrades, every request drains, results already taken for
  // the next batch are discarded, and the degraded batch is measured again
  // alone at the base width, exactly as before.
  const base=options.concurrency,batches=[];
  for(let offset=0;offset<states.length;offset+=options.batchSize)
    batches.push({index:batches.length,offset,states:states.slice(offset,offset+options.batchSize),width:null,next:0,inflight:0,completed:0});
  let planned=base,baseline=null,cooldown=0,evaluated=-1,dispatching=0,inflight=0,failure=null,completedFirst=0;
  const waiters=[],wake=()=>{while(waiters.length)waiters.shift()();},nextEvent=()=>new Promise(resolve=>waiters.push(resolve));
  function summarize(batch) {
    const good=batch.filter(s=>lightValid(s.first));
    return {good:good.length,failed:1-good.length/batch.length,latency:median(good.map(s=>s.first.ms))};
  }
  function capacity(batch) {
    let cap=batch.width;
    for(let i=Math.max(0,evaluated+1);i<=dispatching&&i<batches.length;i++)if(batches[i].inflight>0)cap=Math.min(cap,batches[i].width);
    return cap;
  }
  function launch(batch,state) {
    inflight++;batch.inflight++;stats.maxConcurrency=Math.max(stats.maxConcurrency,inflight);
    (async()=>{
      try {
        stats.firstRequests++;storeSample(state,'first',await probe(state.entry,1));
        stats.firstTested=++completedFirst;
        await emit('first',completedFirst,states.length,batch.width);
      } catch(error) {if(!failure)failure=error||new Error('并发请求处理异常');}
      finally {inflight--;batch.inflight--;batch.completed++;wake();}
    })();
  }
  async function drain() {while(inflight)await nextEvent();}
  async function evaluate(batch) {
    let sample=summarize(batch.states);
    const elevated=batch.width>base&&baseline&&(
      sample.failed>baseline.failed+0.20||sample.latency!==null&&baseline.latency!==null&&
      sample.latency>Math.max(baseline.latency*1.6,baseline.latency+150));
    stats.batches.push({offset:batch.offset,count:batch.states.length,concurrency:batch.width,...sample,rechecked:!!elevated});
    stats.firstConcurrency=batch.width;
    if(elevated) {
      stats.backoffs++;stats.rechecked+=batch.states.length;planned=base;cooldown=2;
      await drain();if(failure)return;
      const ahead=batches[batch.index+1];
      if(ahead&&ahead.width!==null) {
        // Results taken at the raised width while this batch degraded are not kept.
        for(const state of ahead.states.slice(0,ahead.next))storeSample(state,'first',null);
        completedFirst-=ahead.completed;stats.firstTested=completedFirst;stats.discardedAhead=(stats.discardedAhead||0)+ahead.completed;
        Object.assign(ahead,{width:null,next:0,inflight:0,completed:0});
      }
      dispatching=batch.index+1;
      let done=0;stats.firstConcurrency=base;
      batch.states.forEach(state=>storeSample(state,'first',null));
      await pool(batch.states,base,async state=>{
        stats.firstRequests++;storeSample(state,'first',await probe(state.entry,1));done++;
        await emit('first-recheck',done,batch.states.length,base,true);
      });
      sample=summarize(batch.states);
      stats.batches.push({offset:batch.offset,count:batch.states.length,concurrency:base,...sample,recovery:true});
      await emit('first',completedFirst,states.length,base);
      baseline=sample;
    } else if(batch.width===base)baseline=sample;
    if(cooldown>0)cooldown--;else if(stats.backoffs<2&&sample.good>=8)planned=Math.min(options.maxConcurrency,(elevated?base:batch.width)+4);
    const ahead=batches[batch.index+1];
    if(ahead&&ahead.width!==null)ahead.width=Math.max(ahead.width,planned);
  }
  for(;;) {
    if(failure){await drain();throw failure;}
    let progressed=false;
    while(evaluated+1<batches.length) {
      const batch=batches[evaluated+1];
      if(batch.width===null||batch.next<batch.states.length||batch.inflight>0)break;
      await evaluate(batch);evaluated++;progressed=true;
      if(failure){await drain();throw failure;}
    }
    if(evaluated===batches.length-1)break;
    let started=false;
    while(dispatching<batches.length) {
      const batch=batches[dispatching];
      if(batch.width===null) {
        // At most one batch is started ahead of the oldest unevaluated batch.
        if(dispatching>evaluated+2||dispatching>0&&batches[dispatching-1].next<batches[dispatching-1].states.length)break;
        batch.width=planned;
      }
      if(batch.next>=batch.states.length){dispatching++;continue;}
      if(inflight>=capacity(batch))break;
      launch(batch,batch.states[batch.next++]);started=true;
    }
    if(!started&&!progressed) {
      if(!inflight)throw new Error('轻量初筛调度异常');
      await nextEvent();
    }
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
  async function secondSample(state,phase) {
    stats.secondRequests++;storeSample(state,'second',await probe(state.entry,2));stats.secondTested++;
    await emit(phase,stats.secondTested,firstPassed.length,stats.secondConcurrency);
  }
  async function seconds(pending,phase) {
    const todo=pending.filter(s=>lightValid(s.first)&&s.second===undefined);
    await pool(todo,stats.secondConcurrency,state=>secondSample(state,phase));
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
    // No batch barrier: each start re-reads the cutoff from every result
    // completed so far. Adding results can only lower the fast-th latency, and
    // max(first, second) cannot be smaller than first, so an entry whose first
    // latency is strictly above the cutoff is never in the shortlist. Equality
    // is still measured because the key tie-break can change the shortlist.
    let cachedVersion=-1,cachedCutoff=Infinity;
    const cutoff=()=>{
      if(cachedVersion!==sampleVersion){const known=knownOthers();cachedCutoff=known.length>=fast?known[fast-1].lightLatency:Infinity;cachedVersion=sampleVersion;}
      return cachedCutoff;
    };
    await gatedPool(pending,stats.secondConcurrency,state=>state.first.ms<=cutoff(),state=>secondSample(state,'second-latency'));
    const quick=knownOthers().slice(0,fast),quickIPs=new Set(quick.map(e=>e.ip));
    const otherIPs=new Set(otherGroups.map(g=>g.ip));
    const randomGroups=explorationOrder.filter(g=>otherIPs.has(g.ip)&&!quickIPs.has(g.ip));
    // Groups start in exploration order only while found + in-flight groups
    // remain below the quota, so the first qualifying groups in that order are
    // all measured and no group beyond a possible need is started. For a
    // chosen IP, every remaining port is inspected so its best endpoint stays.
    let found=0;
    await gatedPool(randomGroups,stats.secondConcurrency,(g,active)=>found+active<explore,async g=>{
      for(const state of g.states)if(lightValid(state.first)&&state.second===undefined)await secondSample(state,'second-exploration');
      if(best(g))found++;
    });
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
  const progress={version:1,runId,host:opts.host,mode:opts.mode,downloadCandidateLimit:opts.limit,startedAt:start,updatedAt:start,stage:'准备',done:0,total:0,bytes:0};
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
    preflight:{total:0,tested:0,passed:0,unavailable:0,unknown:0,reserveTested:0,notNeeded:0,skippedDownloads:0,reused:0,refreshed:0,ranked:true}};
  progress.premiumFinalFailures=[];
  // A Premium landing page is far larger than a 128 KiB screen sample, so the
  // small screen runs first and Premium is checked in screen-rank order only
  // as deep as needed. Finalists are still exactly the top-ranked screened
  // entries whose first Premium sample is available.
  const premiumEntries=downloadEntries;
  progress.downloadTestedCount=premiumEntries.length;
  const downloadStats=()=>({samples:0,valid:0,partial:0,requests:0,emptyTimeouts:0,failures:{},http:{}});
  progress.downloadDiagnostics={screen:downloadStats(),retest:downloadStats(),examples:[]};
  async function download(e,size,seconds) {
    async function request(partSize,timeout) {
      await guard();const offset=Math.floor(env.random()*150000000);
      const r=await env.probe({descriptor:descriptor(e,baseline.cfg),method:'GET',url:'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg?cf_rank='+runId+'-'+env.id(),timeout,binary:true,
        headers:{Range:'bytes='+offset+'-'+(offset+partSize-1),'Accept-Encoding':'identity','Cache-Control':'no-cache'}});
      progress.bytes+=r.bytes||0;await guard();
      return downloadValid(r,offset,partSize);
    }
    const result=size>2000000?await chunkedDownload(request,size,seconds,2000000,env.now,guard):await request(size,seconds);
    const phase=size===mode.screenBytes?'screen':'retest',stats=progress.downloadDiagnostics[phase];
    stats.samples++;stats.requests+=result.chunks?result.chunks.attempted:1;
    stats.emptyTimeouts+=result.chunks?result.chunks.emptyTimeouts:result.reason==='timeout_empty'?1:0;
    if(result.valid){stats.valid++;if(result.partial)stats.partial++;}
    else {
      stats.failures[result.reason]=(stats.failures[result.reason]||0)+1;
      stats.http[result.status]=(stats.http[result.status]||0)+1;
      if(progress.downloadDiagnostics.examples.filter(e=>e.phase===phase).length<3)progress.downloadDiagnostics.examples.push({phase,requestedBytes:size,
        reason:result.reason,status:result.status,bytes:result.bytes,ms:result.ms,chunks:result.chunks?result.chunks.attempted:1});
    }
    if(result.status===200){await update(progress.stage,progress.done,progress.total);throw new Error('下载源未遵守 Range，已停止，保留原订阅');}
    return result;
  }
  done=0;const screened=[];await update('下载初筛',0,premiumEntries.length);
  await pool(premiumEntries,3,async e=>{const d=await download(e,mode.screenBytes,5);if(d.valid)screened.push({...e,valid:true,score:d.mbps});await update('下载初筛',++done,premiumEntries.length);});
  const ranked=topDistinct(screened,screened.length);
  assert(ranked.length>=10,'有效下载候选不足 10 个，保留原订阅');
  const selected=[],reserveRanking=[],pending=[],rejectedIPs=new Set(),observed=new Map(),initialFinalIPs=new Set();
  progress.refinement={initialCandidates:0,firstSamples:0,secondSamples:0,skippedInvalidFirst:0,skippedByBound:0,
    reserveFirstSamples:0,reserveSecondSamples:0,reserveSkippedInvalidFirst:0,savedSecondSamples:0};
  progress.stability={tested:0,passed:0,failed:0};
  async function stableOne(e) {
    const checks=[];
    for(let n=0;n<3;n++) {
      checks.push(await connect(e,'gstatic'));if(!checks[checks.length-1].valid)break;
      checks.push(await connect(e,'youtube'));if(!checks[checks.length-1].valid)break;
    }
    await guard();
    const valid=checks.length===6&&checks.every(x=>x.valid);
    progress.stability.tested++;progress.stability[valid?'passed':'failed']++;
    return {...e,checks,valid,latency:median(checks.map(x=>x.ms))};
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
    // Reserves have no earlier first sample. Count that completed observation
    // once; later publication refreshes use reuseInitial=false and do not count.
    if(reuseInitial&&!initial) {
      const stats=progress.premium.preflight;
      stats.reserveTested++;
      stats.notNeeded=Math.max(0,stats.total-stats.tested-stats.reserveTested);
    }
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
  async function qualifyOne(e) {
    const result=await checkCandidate(e);
    if(result.status!=='available')return null;
    progress.premium.eligible++;
    return await stableOne({...e,premium:result});
  }
  async function qualifyingBatch(rows,stage,offset=0,total=rows.length) {
    const checked=new Array(rows.length);let done=0;
    await update(stage,offset,total);
    await pool(rows,4,async(e,i)=>{
      checked[i]=await qualifyOne(e);
      await update(stage,offset+(++done),total);
    });
    return checked.filter(Boolean);
  }
  // Four workers keep each node's Premium and stability requests sequential.
  // A node is dispatched only while it could still be one of the first 24
  // first-sample passes in screen order, so every pass is a finalist and its
  // second sample and stability checks follow at once in the same worker.
  // The entire pool drains before any full bandwidth measurement starts.
  const preflightStats=progress.premium.preflight,firstRejected=new Set(),qualified=new Array(ranked.length),finalistFlags=new Array(ranked.length);
  preflightStats.total=ranked.length;let qualifiedDone=0;
  await update('Premium 与稳定性检查',0,Math.min(mode.finalists,ranked.length));
  await rankedPipeline(ranked,4,mode.finalists,async e=>{
    const sample=await premiumProbe(e);
    preflightStats.tested++;
    if(sample.status==='available'){preflightStats.passed++;return sample;}
    preflightStats[sample.status==='unavailable'?'unavailable':'unknown']++;firstRejected.add(e.ip);
    await update('Premium 与稳定性检查',qualifiedDone,Math.min(mode.finalists,ranked.length));
    return null;
  },async(e,index,sample)=>{
    finalistFlags[index]=true;
    qualified[index]=await qualifyOne({...e,premiumInitial:sample});
    await update('Premium 与稳定性检查',++qualifiedDone,Math.min(mode.finalists,ranked.length));
  });
  preflightStats.notNeeded=ranked.length-preflightStats.tested;
  assert(preflightStats.passed>=10,'Premium 首检合格 '+preflightStats.passed+'/10，不足 10 个，保留原订阅');
  const finalists=ranked.filter((e,i)=>finalistFlags[i]);
  const stable=qualified.filter(Boolean).filter(e=>e.valid);
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
  // Unchecked lower ranks stay available; a confirmed first-sample failure
  // is excluded exactly as the former pre-download check excluded it.
  const reserves=ranked.filter(e=>!finalistIPs.has(e.ip)&&!firstRejected.has(e.ip));
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
    '综合检查合格 '+selected.length+'/10，'+(progress.supplement.limited?'补选复测达到上限':'后备候选已用尽')+'，保留原订阅；具体原因见下载与 Premium 诊断');
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
  outcome.downloadDiagnostics=progress.downloadDiagnostics;
  outcome.stability={...progress.stability};
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
const api={MODES,LIGHT_SCREEN,rankedPipeline,gatedPool,settings,ipNumber,numberIP,inPools,endpoint,parseList,includeCurrent,base64Decode,configGuard,parseRaw,parseSurge,sameEntries,sameNamedEntries,namedEntries,countryFlag,publicIPv4,exitCountry,candidates,descriptor,downloadValid,chunkedDownload,topDistinct,scanCount,lightValid,adaptiveLightScreen,pickDownloads,selectiveLightScreen,execute,renameOnly};
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
  if(!s.stage)return 'v0.1.23 已加载 · 尚未开始\n点击上方面板运行完整优选';
  const premium=s.premium||s.result&&s.result.premium;
  const light=s.lightScreen||s.result&&s.result.lightScreen;
  const finalSelection=s.finalSelection||s.result&&s.result.finalSelection;
  const traffic=Math.round(((s.bytes||0)+(premium&&premium.bytes||0))/1000000)+' MB';
  const poolNote=s.poolInfo&&s.poolInfo.source==='cache'?' · 缓存池':s.poolInfo&&s.poolInfo.source==='bundled'?' · 内置池':'';
  if(s.running) {
    const age=Math.max(0,now-(s.updatedAt||s.startedAt||now));
    const names={'正在登录后台':'登录后台','连通性初筛':'连通检查','低流量连通与延迟初筛':'轻量初筛','稳定性与双次下载复测':'双次复测','YouTube Premium 检测':'Premium 预检','轻量初筛降载复核':'降载复核','稳定性检查':'稳定性检查','双次下载复测':'双次复测','后备稳定性检查':'补选稳定性','YouTube Premium 发布前复核':'Premium 复核','后备 Premium 检测':'后备 Premium','后备节点速度复测':'补选复测','更新 Premium 检测记录':'更新 Premium','保存与订阅验证':'保存并核对','完成，订阅已验证':'订阅已核对'};
    Object.assign(names,{'Premium 与稳定性检查':'预检与稳定性','后备 Premium 与稳定性检查':'后备预检与稳定性','下载复测首轮':'首轮复测','下载复测决选':'决选复测','出口与 Premium 最终复核':'出口与 Premium 复核','轻量候选二次复核':'必要二检'});
    if(light&&Number.isInteger(light.firstTested))names['低流量连通与延迟初筛']='轻量首检';
    if(finalSelection&&finalSelection.rejected)names['出口与 Premium 最终复核']='Premium 复核与补位';
    const secondPhase=s.stage==='轻量候选二次复核'&&light&&Number.isInteger(light.firstTested);
    const stage=(names[s.stage]||s.stage)+(secondPhase?' · 请求 '+light.secondRequests+' 次':s.total?' '+(s.done||0)+'/'+s.total:'');
    if(age>=STALE_MS)return '可能暂停或中断 · '+stage+'\n'+duration(age)+'无进展 · '+(age>=RESTART_MS?'点上方重新开始':'保持前台稍候');
    if(s.cancelRequested)return '已请求取消 · '+stage+'\n'+traffic+' · 等待当前请求结束';
    if(s.backendRetry)return stage+'\n'+s.backendRetry+' · '+traffic;
    if(light&&Number.isInteger(light.firstTested)){
      if(s.stage==='低流量连通与延迟初筛')return '轻量首检 '+light.firstTested+'/'+light.firstTotal+'\n首检合格 '+light.firstPassed+' 个 IP · 并发 '+(s.lightConcurrency||8);
      if(s.stage==='轻量候选二次复核')return stage+'\n双检合格 '+light.secondPassed+' 个 IP · 首检覆盖 '+light.firstTested;
      if(s.stage==='轻量初筛降载复核')return stage+'\n首检覆盖 '+light.firstTested+'/'+light.firstTotal+' · 并发 '+(s.lightConcurrency||8);
      if(s.stage==='下载初筛'&&light.selectionComplete)return stage+poolNote+'\n二检 '+light.secondTested+' 次 · 省 '+light.skippedSecond+' 次 · '+traffic;
    }
    if(s.stage==='下载前 Premium 首检')return stage+'\n合格 '+(premium&&premium.preflight&&premium.preflight.passed||0)+' 个 · 尚未下载测速 · '+traffic;
    if(s.stage==='Premium 与稳定性检查'&&premium&&premium.preflight&&premium.preflight.ranked)return stage+'\n首检合格 '+premium.preflight.passed+'/'+premium.preflight.tested+' · 入围 '+(premium.eligible||0)+' · 正文 '+traffic;
    if(s.stage==='Premium 与稳定性检查')return stage+'\nPremium 通过 '+(premium&&premium.eligible||0)+' 个 · 正文 '+traffic;
    if(s.stage==='后备 Premium 与稳定性检查')return stage+'\n已选 '+(premium&&premium.passed||0)+'/10 · 正文 '+traffic;
    if(s.stage==='下载复测决选'&&s.refinement)return stage+'\n已选 '+(premium&&premium.passed||0)+'/10 · 省复测 '+(s.refinement.savedSecondSamples||0)+' 次 · '+traffic;
    if(finalSelection&&['出口与 Premium 最终复核','补位第二次下载'].includes(s.stage)&&finalSelection.rejected)return stage+'\n已确认 '+(premium&&premium.verified||0)+'/10 · 淘汰 '+finalSelection.rejected+' · 补入 '+finalSelection.replacements+' · '+traffic;
    if(s.stage==='出口与 Premium 最终复核')return stage+'\n'+(premium&&premium.preflight?'预检后复核 ':'Premium 复核 ')+(premium&&premium.verified||0)+'/10'+(premium&&premium.recoveryAttempts?' · 恢复 '+(premium.recovered||0)+'/'+premium.recoveryAttempts:'')+' · 正文 '+traffic;
    if(s.stage==='YouTube Premium 检测'&&premium&&premium.eligible!==undefined)return stage+'\n待复测 '+premium.eligible+' 个 · 正文 '+traffic;
    if(s.stage==='低流量连通与延迟初筛'||s.stage==='轻量初筛降载复核')return stage+'\n并发 '+(s.lightConcurrency||8)+' · '+duration(now-(s.startedAt||now))+' · 正文 '+traffic;
    if(s.stage==='YouTube Premium 检测'||s.stage==='YouTube Premium 发布前复核')return stage+'\n'
      +(s.stage==='YouTube Premium 检测'?'通过 '+(premium&&premium.passed||0):'复核 '+(premium&&premium.verified||0))+'/10 · 正文 '+traffic;
    if(['后备 Premium 检测','后备稳定性检查','后备节点速度复测','更新 Premium 检测记录'].includes(s.stage))return stage+'\n已选 '+(premium&&premium.passed||0)+'/10 · 正文 '+traffic;
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

const CF_RANK_POOLS=["162.159.32.0/20","8.35.211.0/24","8.39.125.0/24","188.164.248.0/24","108.162.198.0/24","162.159.38.0/23","91.193.58.0/23","172.66.0.0/22","104.16.144.0/20","104.16.240.0/20","104.17.16.0/20","104.17.48.0/20","104.17.96.0/20","104.17.112.0/20","104.17.144.0/20","104.17.160.0/20","104.17.176.0/20","104.17.208.0/20","104.18.33.0/24","104.19.32.0/22","104.19.48.0/21","104.19.144.0/21","198.41.208.0/23","104.26.0.0/20","172.67.64.0/20"];
const CF_RANK_OFFICIAL=["173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22","141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20","197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13","104.24.0.0/14","172.64.0.0/13","131.0.72.0/22"];
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
const UA='CF-Edge-AutoRank/0.1.23';
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
    if(p.ranked) {
      lines.push('Premium 首检（按下载初筛排名，凑满入围即停）：已测 '+p.tested+'/'+p.total+' · 合格 '+p.passed+' · 地区不可用 '+p.unavailable+' · 未确认 '+p.unknown);
      if(Number.isInteger(p.reserveTested)&&p.reserveTested>=0)lines.push('Premium 检测范围：首轮 '+p.tested+' 个 · 后备 '+p.reserveTested+' 个 · 本轮尚未首检 '+Math.max(0,p.total-p.tested-p.reserveTested)+' 个');
    }
    else lines.push('下载前 Premium 首检：已测 '+p.tested+'/'+p.total+' · 合格 '+p.passed+' · 地区不可用 '+p.unavailable+' · 未确认 '+p.unknown+' · 跳过下载 '+p.skippedDownloads+' 个');
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
    '本轮 '+result.lightScreen.firstTested+'/'+result.lightScreen.firstTotal+' 个入口完成首检，'+result.lightScreen.firstPassed+' 个 IP 首检合格；'+result.lightScreen.secondPassed+' 个 IP 已确认双检合格，'+result.downloadCandidateCount+' 个下载候选全部完成下载初筛，按排名对其中 '+(result.premium.preflight?result.premium.preflight.tested:0)+' 个做了 Premium 首检，后备另检 '+(result.premium.preflight&&result.premium.preflight.reserveTested||0)+' 个':
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
