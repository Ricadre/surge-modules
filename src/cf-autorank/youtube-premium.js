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
async function probe(env,descriptor,guard) {
  await guard();
  const r=await env.probe({descriptor,method:'GET',
    url:'https://www.youtube.com/premium?hl=en&cf_rank_premium='+env.id(),timeout:8,
    headers:{'User-Agent':UA,Accept:'text/html','Accept-Language':'en-US,en;q=0.9','Cache-Control':'no-cache','Connection':'close'}});
  await guard();
  return {...classify(r),checkedAt:env.now(),bytes:typeof r.data==='string'?utf8Bytes(r.data):Number(r.bytes)||0};
}
function qualified(value,now) {
  return !!value&&value.status==='available'&&/^[A-Z]{2}$/.test(value.region||'')&&Array.isArray(value.samples)&&value.samples.length===3&&value.samples.every(s=>
    s.status==='available'&&s.reason==='full_premium_offer'&&s.region===value.region&&
    Number.isFinite(s.checkedAt)&&s.checkedAt<=now&&now-s.checkedAt<=MAX_AGE);
}
const api={MAX_AGE,MAX_HTML,initialData,classify,probe,qualified,utf8Bytes};
if(typeof module==='object'&&module.exports)module.exports=api;else root.CFYouTubePremium=api;
})(typeof globalThis==='object'?globalThis:this);
