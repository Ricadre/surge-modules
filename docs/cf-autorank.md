# Cloudflare 一键优选 · 0.1.4 预览版

在 iPhone 或 Mac 的当前网络里测试候选 CF 入口，复测后选出 10 个不同 IP，自动保存到已有 edgetunnel 后台的自定义列表。成功提示之后，手动刷新原有 Surge 订阅即可。

## 远程安装

在 Surge 的模块页面选择通过 URL 安装，粘贴：

```text
https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/CF-AutoRank.sgmodule
```

[用 Surge 打开安装](surge:///install-module?url=https%3A%2F%2Fraw.githubusercontent.com%2FRicadre%2Fsurge-modules%2Fmain%2Fmodules%2FCF-AutoRank.sgmodule)

模块自动从同一公开仓库下载 `scripts/CF-AutoRank.js`，无需放置本地文件、GitHub 登录或访问令牌。地址里不要追加密码。请使用支持模块参数和 WebView 脚本的新版 Surge。若以前手动安装了本工具的本地模块，先停用旧模块，避免同名脚本和面板重复。

安装时填写参数：

| 参数 | 填写方式 |
| --- | --- |
| `backend` | 自己的后台域名，如 `edge.example.com`；不含 `https://`、`/admin` 或末尾斜杠。默认留空。 |
| `admin_password` | edgetunnel 后台登录密码，默认留空。不是订阅 token 或节点 UUID。 |
| `mode` | 默认 `lite` 省流档；`full` 完整档。 |
| `candidates` | 默认 `320`；可填 40–1024。当前发布入口也参加比较。 |

参数由 Surge 保存，不会提交到本仓库。密码参数不等同于系统钥匙串；请勿分享参数截图、填好密码的模块或完整日志。密码包含双引号、反斜杠、换行，或原密码以 `b64:` 开头时，请填 `b64:` 加原密码的 UTF-8 Base64。Base64 仅解决参数转义，不是加密；不要使用在线网站编码密码。

## 使用与进度

更新原模块到 0.1.4，保留后台参数，不要重复安装。若当前有测速任务，先等它完成或从脚本列表运行 `CF-Rank-Cancel` 并等当前请求结束，再更新，避免旧脚本与新版同时运行。

**Cloudflare 一键优选**：橙色云朵 `cloud.fill`，点击一次完成测速、前十筛选、后台保存和两种订阅核对。它显示上次成功的记录，示例如下（示例数据）：

```text
上次更新 01/01 12:00 · 10 节点
Wi-Fi 家中网络 · 省流 · 123 MB
```

**Cloudflare 测速进度**：独立的只读面板，显示本轮阶段、该阶段的已测数/总数及百分比，以及耗时、已接收下载数据量、距最近活动的时间。例如：

```text
双次复测 7/24 · 29%
2分18秒 · 56 MB · 3秒前进展
```

- 第二个面板刷新只读本机记录，不测速、不登录或改写后台。状态脚本使用轻量 JSC 引擎，与运行测速的 WebView 会话分开。
- 进度和最后成功记录保存在本机，切走 App 或面板的旋转动画消失不等于记录消失。返回 Surge **策略页面**时会检查自动刷新；停留页面时如未刷新，可点击进度面板的刷新按钮。`update-interval=1` 不是保证后台每秒运行的定时器。
- 连续 90 秒没有脚本活动，显示“可能暂停或中断”，不假装任务还在前进。3 分钟无活动后可点击主面板重新开始；新版旧任务恢复时会检查本机任务标识，不能再覆盖新任务状态或继续发起后台写入。它不是断点续测，重新开始会重新消耗测速流量。
- 切到其他 App 后，系统可能限制或暂停脚本；模块能保留并显示最后进度，**不能保证后台持续测速**。希望完成整轮时仍请保持 Surge 前台、屏幕亮起、不切换网络。
- 成功后在原 CF 订阅里手动刷新即可。取消、完整日志和单独核对仍可从脚本列表调用 `CF-Rank-Cancel`、`CF-Rank-Status`、`CF-Rank-Verify`。

主面板只保留最近一次成功记录；下一轮失败或取消不会覆盖它。列表未变化时标注“上次核对”，避免把核对当作新发布。时间使用北京时间。Wi-Fi 名称记录的是**那次成功测速时的网络**，不会用现在的网络冒充历史记录；旧版没记录名称时显示“网络未记录”，系统未提供 SSID 时显示“Wi-Fi 名称不可用”。长名称会缩略，完整名称只在本机状态中保存，不发送到 GitHub 或 edgetunnel。

Surge 原生面板支持 SF Symbols 和颜色，不支持把品牌图片直接用作此类图标，因此使用橙色云朵近似 Cloudflare 风格。脚本一轮只能完成一次显示提交；独立的进度面板可在长任务未结束时读取记录，不依赖主面板的加载动画。两张卡都输出至多两行正文；实际折行和字号由 Surge 界面决定。

本模块仅添加 Script 和 Panel，不包含代理、策略组、分流规则或 MITM。没有自动测速任务，面板自动刷新只读状态。测速使用临时 CF 策略，不切换当前策略组；后台控制请求直连用户指定域名。请停用可能覆盖结果的其他定时优选任务，一次只在一台设备上运行。

## 测试范围与流量

- 每轮生成指定数量的候选入口，覆盖允许网段及 443、2053、8443 端口，包括当前发布节点；并非穷举所有 Cloudflare IP。
- 全部候选先检查连接，可连接入口进行实际下载初筛；前 24 个不同 IP 进行两次下载复测和多次 YouTube 连通性检查，按两次下载的较低速度取前 10。
- 默认 320 个候选：省流档通常约 100–200 MB，完整档约 300–600 MB，实际消耗取决于成功请求数、候选数量和协议开销；这些不是运营商流量硬上限。
- 下载采用随机查询参数和随机 Range，校验 HTTP 206、Content-Range 和字节数。超时但收到有效数据时标记为限时样本，不称作完整下载。
- 排名只代表本轮候选在当前设备网络的表现，不能保证换网后仍可用。当前网络有路由器代理时，测试也会受它影响。

## 后台要求与更新保护

支持当前已适配的 cmliu/edgetunnel 接口：Trojan + WebSocket、路径 `/`、正常 TLS 验证、自定义 IPv4:TLS端口列表。域名须与后台 HOST 一致，不启用随机路径、0-RTT 或 ECH。后台若不符合这些条件会停止，不会替用户切换模式或协议。

开始时备份旧列表，写入前再次比较连接参数、自定义列表和实际原始订阅。有效候选不足 10 个、取消、网络变化或检测到用户改动时不发布；仅允许写 `/admin/ADD.txt`。保存后核对原始订阅和 Surge 转换订阅的入口及连接参数。核对失败时，仅在后台列表仍属于本轮写入时请求恢复，结果面板会说明是否需要人工检查。现有后台接口没有原子事务锁，不能保证跨设备并发写入。

## 验证与限制

自动化检查覆盖候选抽样、参数解析、模拟发布及恢复、国旗转换、网络变化和进度存储。构建与语法检查不能替代目标设备和当前网络的运行验证。模块保留预览版标记，不保证 iOS 后台持续运行或跨网络速度。

维护命令（Node.js 20+）：

```sh
node --test tests/cf-autorank/*.test.cjs
node scripts/build_cf_autorank.cjs
node scripts/build_cf_autorank.cjs --check
node --check scripts/CF-AutoRank.js
```

[Surge 面板刷新与图标说明](https://manual.nssurge.com/tools/panel.html) · [Surge 脚本 API](https://manual.nssurge.com/scripting/api.html) · [Surge 模块参数说明](https://manual.nssurge.com/profile/module.html) · [Surge 安装模块 URL Scheme](https://manual.nssurge.com/tools/url-scheme.html)
