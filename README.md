# Surge 模块

个人维护的 Surge 模块集合。远程模块统一放在 `modules/`，后续模块也放在这里。

## 模块列表

| 模块 | 当前状态 | 远程地址 |
| --- | --- | --- |
| Cloudflare 一键优选 | 0.1.11 · 1280 个轻量初筛 → 最多 160 个下载 → 前十，默认省流，预览版 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/CF-AutoRank.sgmodule) |
| 高德地图推广过滤 | 0.2.0 · 个人主页推广过滤，测试版 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/Amap-AdBlock.sgmodule) |
| 豆瓣开屏广告过滤 | 0.1.0 · 仅处理开屏接口 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/Douban-Splash-AdBlock.sgmodule) |
| 小宇宙开屏广告过滤 | 0.1.1 · 仅处理开屏接口 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/Xiaoyuzhou-Splash-AdBlock.sgmodule) |

## Cloudflare 一键优选（预览版）

在当前 iPhone / Mac 网络中手动测试 CF 候选入口，取复测排名靠前的 10 个不同 IP，自动更新已有 edgetunnel 后台自定义列表；成功后手动刷新原 Surge 订阅。默认省流档，保留完整档。模块自动下载远程脚本，只需填写后台域名和后台密码，无需手动放置文件；公开文件不含个人凭据。

后台上游为 **[cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)**，提供 Cloudflare 隧道、管理面板与订阅；本仓库实现 Surge 端的测速、排名、出口国旗和自动回写。具体分工见[上游项目说明](docs/cf-autorank.md#上游项目与本模块的关系)。

手动刷新主面板：**更新池与备份 → 1280 个轻量初筛 → 最多 160 个下载初筛 → 前 24 个双次复测 → 前 10 个出口检测 → 保存并验证订阅**。成功后手动刷新原 CF 订阅。进度面板及自动刷新只读状态，不启动测速。完整顺序与请求路径见[操作流程](docs/cf-autorank.md#点击面板刷新后会发生什么)。

以后统一使用[固定模块地址](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/CF-AutoRank.sgmodule)。从旧版本地址迁移一次后，在 Surge 中更新同一个模块即可，后台参数保存在本机。带版本号的文件仅用于复现和回退；内部 JS 引用随模块更新。

“Cloudflare 一键优选”使用橙色云朵，点一次运行完整流程，下方两行显示上次成功时间、当时的 Wi-Fi/蜂窝网络、节点数、档位和数据量。独立的“Cloudflare 测速进度”面板只读本机记录，切回策略页面或点击刷新可查看阶段、数量、耗时及最近活动；长期无活动会提示可能暂停或中断，不保证 iOS 后台持续运行。

自动化检查覆盖模块语法和模拟数据；不同设备、网络和 App 版本的兼容性需分别确认。安装与限制见 [Cloudflare 优选说明](docs/cf-autorank.md)。

## 高德地图推广过滤（测试版）

高德模块按接口结构清理“我的”任务、活动轮播、推荐流、借钱入口及卡片内推广，保留订单、收藏、足迹和语音等功能。规则匹配不代表所有 App 版本均兼容；未知字段尽量保留。

在 Surge 模块页面从 Raw 地址安装或更新，确认版本 **0.2.0**。需要 Surge iOS 5.14.0+、重写、MITM 及已信任的证书。其他高德模块保持停用，再启用本模块并彻底退出、重开高德。发布不会自动替换手机上的旧模块。

取消旧版首页和“我的”的卡片保留列表，保留未知卡片及正常服务。订单、收藏、待评价、钱包、足迹、语音／车标设置、家人地图、工具、好友动态和勋章入口保留。使用内置 JQ，无远程脚本依赖。详细范围、已知限制和回退方法见[高德模块说明](docs/amap-ad-filter.txt)。

## 豆瓣开屏广告过滤

在 Surge 的模块页面通过上述 Raw 地址安装。需要 Surge iOS 5.14.0+、开启重写和 MITM，并安装、完全信任 Surge 证书。模块仅对 `api.douban.com` 的两个开屏接口清空广告列表，无外部脚本依赖；不处理豆瓣信息流广告。

豆瓣模块仅清空开屏广告列表。已缓存的素材可能需要联网并重新启动 App 后更新；效果受 App 版本、缓存和投放方式影响。

详细范围、验证方法和恢复方法见[豆瓣模块说明](docs/douban-splash.txt)。远程地址保持稳定，后续可通过 Surge 更新。

## 小宇宙开屏广告过滤（测试版）

仅对 `api.xiaoyuzhoufm.com/v1/flash-screen/list` 返回空 JSON，不改写订阅、搜索、节目和音频播放接口。使用 Surge 原生 Map Local，无外部脚本，需 Surge iOS 5.9.1+、重写、MITM 和已信任的证书。安装后彻底退出并重开小宇宙，缓存广告可能需后续启动才消失。

小宇宙模块依据公开接口线索实现，仅匹配指定开屏路径。缓存素材可能在重新启动 App 后更新；普通功能和不同 App 版本需分别验证。范围、来源和恢复步骤见[小宇宙模块说明](docs/xiaoyuzhou-splash.txt)。

## X 模块已删除

X 模块及其专用实现已从当前分支移除，旧 Raw 地址不再提供模块。远端删除不会自动卸载本地副本，已有安装应在 Surge 中手动停用或删除。

X 实验模块存在加载兼容性问题。网页版过滤规则和 App 内修改方案不能直接证明 Surge 对官方 X App 的适用性；本仓库不再提供 X 去广告模块。详见[说明](docs/x-ad-filter.txt)。

## 目录与维护

```text
modules/   远程发布的 Surge 模块
src/       模块源代码
scripts/   构建脚本，以及 CF-AutoRank.js 远程运行文件
tests/     各模块自动化检查（CF 测试位于 cf-autorank/）
docs/     模块说明
```

```sh
python3 scripts/build_amap.py --check
python3 tests/test_amap_ad_filter.py
python3 tests/test_douban_splash.py
python3 tests/test_xiaoyuzhou_splash.py
```

广告模块构建只需 Python 3；规则测试还需 jq 1.7+。`build_amap.py` 生成高德测试版。测试检查 URL 范围、过滤逻辑、保留字段及未知结构兼容，不能替代手机验证。

CF 模块单独使用 Node.js 20+：

```sh
node --test tests/cf-autorank/*.test.cjs
node scripts/build_cf_autorank.cjs --check
node --check scripts/CF-AutoRank.js
```

新增模块使用独立文件和说明，保持远程路径稳定。未实机验证的模块需明确标为测试版，由用户主动选择安装，不自动加入主配置。不要将个人代理配置、Cookie、令牌、证书或私钥放入此公开仓库。

提交身份、通用文档要求及历史同步方式见[维护与隐私](docs/maintenance.md)。

## 参考

- [Surge 模块机制](https://manual.nssurge.com/profile/module.html)
- [Surge JQ Body Rewrite](https://manual.nssurge.com/http/body-rewrite.html)
