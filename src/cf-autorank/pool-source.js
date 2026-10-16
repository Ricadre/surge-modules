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
