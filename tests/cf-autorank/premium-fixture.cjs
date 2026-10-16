// Synthetic public-page structures, not recorded responses or account data.
function page({region='US',lite=false,disabled=false,unavailable=false}={}) {
 const option={title:{content:'$10 / month'},purchaseButtonOverride:{buttonViewModel:{
  state:disabled?'BUTTON_VIEW_MODEL_STATE_DISABLED':'BUTTON_VIEW_MODEL_STATE_ACTIVE',
  onTap:{innertubeCommand:{signInEndpoint:{nextEndpoint:{browseEndpoint:{
   browseId:'SPunlimited',canonicalBaseUrl:lite?'/premiumlite':'/premium',params:'synthetic-offer'
  }}}}}
 }}};
 const data={contents:{sectionListRenderer:{contents:[{lpOfferCardOptionViewModel:option},
  {description:{simpleText:unavailable?'YouTube Premium is not available in your country':'YouTube Premium'}}]}}};
 return '<html><script>ytcfg.set('+JSON.stringify({INNERTUBE_CONTEXT_GL:region})+');</script><script>var ytInitialData = '+JSON.stringify(data)+';</script></html>';
}
module.exports=page;
