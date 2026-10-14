const test=require('node:test'),assert=require('node:assert/strict');
const U=require('../../src/cf-autorank/panel.js');
const now=Date.UTC(2026,9,14,14,19,0);
const history={at:now,network:{kind:'wifi',name:'Home Wi-Fi'},mode:'lite',count:10,bytes:123000000,changed:true};
test('main card uses saved successful network and Beijing time in two lines',()=>{
  const v=U.view('main',{lastSuccess:history,network:{kind:'wifi',name:'Different Wi-Fi'},running:true},now,'full');
  assert.equal(v.title,'Cloudflare 一键优选');assert.equal(v.icon,'cloud.fill');assert.equal(v.style,undefined);
  assert.match(v.content,/10\/14 22:19/);assert.match(v.content,/Home Wi-Fi/);assert(!v.content.includes('Different'));
  assert.match(v.content,/省流 · 123 MB/);assert.equal(v.content.split('\n').length,2);
});
test('old successful records never invent the Wi-Fi name',()=>{
  const v=U.view('main',{stage:'完成',updatedAt:now,result:{changed:true,selected:Array(10).fill({})}},now,'lite');
  assert.match(v.content,/网络未记录/);assert.match(v.content,/10 节点/);
});
test('network metadata distinguishes cellular and unavailable Wi-Fi names',()=>{
  assert.equal(U.networkText(U.networkInfo({v4:{primaryInterface:'pdp_ip0'},wifi:{}})),'蜂窝网络');
  assert.equal(U.networkText(U.networkInfo({wifi:{}})),'Wi-Fi 名称不可用');
  assert(!U.networkText(U.networkInfo({wifi:{ssid:'Very long\nWi-Fi network name'}})).includes('\n'));
});
test('progress percentage is per stage and shows elapsed data and activity age',()=>{
  const s={running:true,stage:'下载初筛',done:80,total:320,bytes:16000000,startedAt:now-92000,updatedAt:now-2000};
  const v=U.view('status',s,now,'lite');
  assert.equal(v.content,'下载初筛 80/320 · 25%\n1分32秒 · 16 MB · 2秒前进展');
});
test('stale state is uncertain rather than falsely running or complete',()=>{
  const s={running:true,stage:'双次复测',done:7,total:24,updatedAt:now-95000};
  assert.match(U.view('status',s,now).content,/可能暂停或中断/);
  assert.match(U.view('status',s,now).content,/保持前台稍候/);
  assert.match(U.view('status',{...s,updatedAt:now-181000},now).content,/点上方重新开始/);
});
test('unchanged successful list is labelled checked rather than newly published',()=>{
  assert.match(U.view('main',{lastSuccess:{...history,changed:false}},now).content,/上次核对/);
});
