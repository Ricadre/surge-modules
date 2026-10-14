# Surge 模块

个人维护的 Surge 模块集合。远程模块统一放在 `modules/`，后续模块也放在这里。

## 模块列表

| 模块 | 当前状态 | 远程地址 |
| --- | --- | --- |
| CF 本机优选与自动订阅 | 0.1.2 · 预览版，修复空参数导入错误 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/CF-AutoRank.sgmodule) |
| 高德地图推广过滤 | 0.1.0 · 测试版，尚未完成实机验证 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/Amap-AdBlock.sgmodule) |
| 豆瓣开屏广告过滤 | 0.1.0 · 仅处理开屏接口 | [模块 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/Douban-Splash-AdBlock.sgmodule) |
| X 信息流广告过滤 | 0.1.1 · 已停用，无过滤功能 | [停用版 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule) |

## CF 本机优选与自动订阅（预览版）

在当前 iPhone / Mac 网络中手动测试 CF 候选入口，取复测排名靠前的 10 个不同 IP，自动更新已有 edgetunnel 后台自定义列表；成功后手动刷新原 Surge 订阅。默认省流档，保留完整档。模块自动下载远程脚本，只需填写后台域名和后台密码，无需手动放置文件；公开文件不含个人凭据。

仅添加脚本与面板，不包含分流规则、策略组或 MITM。20 项自动化测试通过，iPhone 整轮测速和真实后台自动回写尚待验证。安装参数、流量说明、支持范围和操作步骤见 [CF 优选说明](docs/cf-autorank.md)。

## 高德地图推广过滤（测试版）

高德模块为手动安装的测试版，覆盖开屏、首页、搜索和个人主页的部分推广。兼容性以接口结构及规则匹配情况为准。

在 Surge 模块页面从 Raw 地址安装，需要 Surge iOS 5.14.0+、重写、MITM 及已信任的证书。先停用或删除旧的 **Amap AdBlock - Syntax Fix** 和其他高德模块，再启用本模块并彻底退出、重开高德。此前旧模块只执行了停用，尚未删除；发布不会自动替换手机上的旧模块。

首页和“我的”采用卡片保留列表，可能同时隐藏部分非广告服务卡片；普通搜索结果、路线接口、订单接口不在拦截范围内，但仍需实机检查正常加载。使用内置 JQ，无远程脚本依赖。详细范围、已知限制、测试方法和含手动 MITM 条目的回退说明见[高德模块说明](docs/amap-ad-filter.txt)。

## 豆瓣开屏广告过滤

在 Surge 的模块页面通过上述 Raw 地址安装。需要 Surge iOS 5.14.0+、开启重写和 MITM，并安装、完全信任 Surge 证书。模块仅对 `api.douban.com` 的两个开屏接口清空广告列表，无外部脚本依赖；不处理豆瓣信息流广告。

豆瓣模块仅清空开屏广告列表。已缓存的素材可能需要联网并重新启动 App 后更新；效果受 App 版本、缓存和投放方式影响。

详细范围、验证方法和恢复方法见[豆瓣模块说明](docs/douban-splash.txt)。远程地址保持稳定，后续可通过 Surge 更新。

## X 模块已停用

X 实验模块存在正常加载兼容性问题，不建议用于官方 X App；出现异常时停用模块并重新启动 App。

同一远程地址现发布 **0.1.1 停用版**，仅保留元数据与说明，已移除所有 MITM、重写和其他生效配置，**不提供去广告功能**。源文件与历史提交保留用于研究。

### 已安装 X 模块的用户

1. 在 Surge 中停用“X 信息流广告过滤（实验版）”，彻底退出并重新打开 X。
2. 可以直接删除模块；也可以在 Surge 中更新同一远程地址，确认内容为 `#!version=0.1.1`，显示名称为“X 信息流广告过滤（已停用）”。无需重新启用测试。
3. 发布新版不等于手机已经更新；没有获取到 0.1.1 时，请继续保持旧模块停用。停用版本不会改动主配置或其他模块中的 MITM 设置。

远程地址继续保留，便于已有安装获取撤回版本：

```text
https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule
```

详细记录见[问题与恢复说明](docs/x-ad-filter.txt)。目前没有已验证适用于该用户官方 X App 的去广告模块。

### X 模块已知情况

X 实验模块存在正常加载兼容性问题，不建议用于官方 X App；出现异常时停用模块并重新启动 App。

Surge 官方说明[启用 MITM 可能中断采用证书锁定的 App 连接](https://manual.nssurge.com/http/mitm.html)，并在[主机列表示例](https://manual.nssurge.com/profile/host-list.html)中排除了 Twitter。`skip-server-cert-verify` 不能解决 App 拒绝 Surge 证书的问题。

过去的 JSON 样本测试仅验证过滤表达式，无法证明原生 App 可以解密或实际可用。

## 目录与维护

```text
modules/   远程发布的 Surge 模块
src/       模块源代码及历史过滤逻辑
scripts/   构建脚本，以及 CF-AutoRank.js 远程运行文件
tests/     各模块自动化检查（CF 测试位于 cf-autorank/）
docs/     模块说明
```

```sh
python3 scripts/build.py
python3 scripts/build.py --check
python3 scripts/build_amap.py --check
python3 tests/test_amap_ad_filter.py
python3 tests/test_douban_splash.py
python3 tests/test_x_ad_filter.py
```

广告模块构建只需 Python 3；规则测试还需 jq 1.7+。`build.py` 只生成 X 停用版，不会将 `src/x-ad-filter.jq` 重新发布为活动规则；`build_amap.py` 生成高德测试版。测试检查 URL 范围、过滤逻辑、保留字段、未知结构兼容及 X 停用状态，不能替代手机验证。

CF 模块单独使用 Node.js 20+：

```sh
node --test tests/cf-autorank/*.test.cjs
node scripts/build_cf_autorank.cjs --check
node --check scripts/CF-AutoRank.js
```

新增模块使用独立文件和说明，保持远程路径稳定。未实机验证的模块需明确标为测试版，由用户主动选择安装，不自动加入主配置。不要将个人代理配置、Cookie、令牌、证书或私钥放入此公开仓库。

## 参考

- [Surge 模块机制](https://manual.nssurge.com/profile/module.html)
- [Surge JQ Body Rewrite](https://manual.nssurge.com/http/body-rewrite.html)
- [公开的 X 网页版广告条目结构参考](https://github.com/5jwoj/Surge/tree/main/X)
- [NeoFreeBird 的 App 内广告处理](https://github.com/NeoFreeBird/app/blob/eb25822b451f27f512a5bb9e4fc5eb742b46e54b/src/Hooks/Ads.x)：原生 App Hook 无法直接移植为 Surge 规则。

历史过滤表达式独立实现，未复制或加载上述项目的脚本。
