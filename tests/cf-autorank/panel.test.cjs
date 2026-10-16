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
  assert(!v.content.includes('YT✓'));
});
test('Premium progress and verified history use two lines without retroactively upgrading old results',()=>{
 const state={running:true,stage:'YouTube Premium 检测',done:12,total:24,bytes:100000000,startedAt:now-50000,updatedAt:now,
  premium:{tested:12,passed:8,verified:0,bytes:12000000}};
 let v=U.view('status',state,now,'lite');assert.equal(v.content,'Premium 预检 12/24\n通过 8/10 · 正文 112 MB');
 v=U.view('status',{...state,stage:'YouTube Premium 发布前复核',done:4,total:10,premium:{...state.premium,verified:4}},now);
 assert.match(v.content,/复核 4\/10/);assert.equal(v.content.split('\n').length,2);
 v=U.view('main',{lastSuccess:{...history,premiumVerified:10,premiumBytes:30000000}},now);
 assert.match(v.content,/YT✓/);assert.match(v.content,/153 MB/);assert.equal(v.content.split('\n').length,2);
});
test('network metadata distinguishes cellular and unavailable Wi-Fi names',()=>{
  assert.equal(U.networkText(U.networkInfo({v4:{primaryInterface:'pdp_ip0'},wifi:{}})),'蜂窝网络');
  assert.equal(U.networkText(U.networkInfo({wifi:{}})),'Wi-Fi 名称不可用');
  assert(!U.networkText(U.networkInfo({wifi:{ssid:'Very long\nWi-Fi network name'}})).includes('\n'));
});
test('progress percentage is per stage and shows elapsed data and activity age',()=>{
  const s={running:true,stage:'下载初筛',done:80,total:320,bytes:16000000,startedAt:now-92000,updatedAt:now-2000};
  const v=U.view('status',s,now,'lite');
  assert.equal(v.content,'下载初筛 80/320 · 25%\n1分32秒 · 正文 16 MB · 2秒前进展');
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
test('existing progress card identifies fallback pools while staying at two lines',()=>{
 for(const [source,note] of [['cache','缓存池'],['bundled','内置池']])for(const running of [true,false]) {
  const state={running,stage:running?'下载初筛':'完成',done:40,total:320,startedAt:now-10000,updatedAt:now,poolInfo:{source}};
  const card=U.view('status',state,now,'lite');assert(card.content.includes(note));assert.equal(card.content.split('\n').length,2);
 }
});

test('reserve and evidence-refresh stages persist selection counts in the existing two-line panel',()=>{
 for(const [stage,label] of [['后备 Premium 检测','后备 Premium'],['后备节点速度复测','补选复测'],['更新 Premium 检测记录','更新 Premium']]) {
  const s={running:true,stage,done:2,total:16,updatedAt:now,bytes:120000000,premium:{passed:7,bytes:30000000}};
  const card=U.view('status',s,now,'lite');
  assert.equal(card.content,label+' 2/16\n已选 7/10 · 正文 150 MB');
 }
});
test('optimized stages show concurrency or preflight counts without adding a panel',()=>{
 const s={running:true,updatedAt:now,startedAt:now-30000,bytes:21000000,premium:{eligible:15,passed:0,bytes:5000000}};
 assert.equal(U.view('status',{...s,stage:'YouTube Premium 检测',done:20,total:24},now).content,'Premium 预检 20/24\n待复测 15 个 · 正文 26 MB');
 assert.match(U.view('status',{...s,stage:'低流量连通与延迟初筛',done:128,total:1280,lightConcurrency:16},now).content,/并发 16/);
 assert.match(U.view('status',{...s,stage:'轻量初筛降载复核',done:12,total:64,lightConcurrency:8},now).content,/降载复核 12\/64\n并发 8/);
});
test('two-pass and pipelined stages retain compact progress without counting incomplete nodes as selected',()=>{
 const s={running:true,updatedAt:now,startedAt:now-30000,bytes:21000000,done:12,total:24,
  premium:{eligible:15,passed:0,verified:0,bytes:5000000},refinement:{savedSecondSamples:4}};
 const pre=U.view('status',{...s,stage:'Premium 与稳定性检查'},now).content;
 assert.equal(pre,'预检与稳定性 12/24\nPremium 通过 15 个 · 正文 26 MB');
 const first=U.view('status',{...s,stage:'下载复测首轮'},now).content;
 assert.match(first,/首轮复测 12\/24/);assert(!first.includes('已选'));
 const final=U.view('status',{...s,stage:'下载复测决选',premium:{...s.premium,passed:10}},now).content;
 assert.equal(final,'决选复测 12/24\n已选 10/10 · 省复测 4 次 · 26 MB');
 const reserve=U.view('status',{...s,stage:'后备 Premium 与稳定性检查',premium:{...s.premium,passed:7}},now).content;
 assert.match(reserve,/已选 7\/10/);
 const verify=U.view('status',{...s,stage:'出口与 Premium 最终复核',done:3,total:10,premium:{...s.premium,verified:3}},now).content;
 assert.equal(verify,'出口与 Premium 复核 3/10\nPremium 复核 3/10 · 正文 26 MB');
 for(const text of [pre,first,final,reserve,verify])assert.equal(text.split('\n').length,2);
});
