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
  if(/(?:YouTube\s+)?Premium\s+(?:is\s+)?(?:not(?:\s+yet)?\s+available|unavailable)\s+in\s+your\s+(?:country|region)|(?:couldn[’']t|cannot|can[’']t)\s+verify\s+your\s+country/i.test(text))return result('unavailable','region_unavailable');
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
  const permanent=['region_unavailable','challenge','body','page_format','region_unknown','no_full_premium_offer'];
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
