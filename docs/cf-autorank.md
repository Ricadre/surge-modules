# CF 本机优选与自动订阅 · 0.1.1 预览版

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

## 使用

1. 启用模块，在 Surge 面板中添加或找到“CF 开始优选并更新”。
2. 连接要测试的蜂窝网络或 Wi-Fi，手动点击开始。保持 Surge 前台、屏幕亮起，测试期间不切换网络。
3. “CF 查看进度”显示阶段和已收到的下载数据；“CF 取消本轮”请求停止。保存期间会先完成核对或请求恢复。
4. 只有看到“前十已保存，原始和 Surge 订阅均已核对”之后，再刷新原有 CF 订阅。“CF 复查订阅”可单独检查传播结果。

本模块仅添加 Script 和 Panel，不包含代理、策略组、分流规则、MITM 或自动定时任务。它使用临时 CF 策略逐个测试，不切换当前策略组；后台控制请求直连用户指定域名。用户点击开始后才会登录后台、测速和更新自定义列表。请停用可能覆盖结果的其他定时优选任务，一次只在一台设备上运行。

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

[Surge 模块参数说明](https://manual.nssurge.com/profile/module.html) · [Surge 安装模块 URL Scheme](https://manual.nssurge.com/tools/url-scheme.html)
