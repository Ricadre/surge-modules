# 咪咕视频与航旅纵横轻量去广告

两个独立模块均为 **0.1.0 测试版**。远程路径固定，后续可直接在 Surge 中更新；无需填写账号、密码或后台地址。

## 安装和迁移

| 模块 | GitHub 原始文件 | 镜像下载 |
| --- | --- | --- |
| 咪咕视频 · 广告域名补充 | [Raw](https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/MiguVideo-AdBlock-Lite.sgmodule) | [镜像模块](https://gh-proxy.com/https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/MiguVideo-AdBlock-Lite.sgmodule) |
| 航旅纵横 · 轻量去广告 | [Raw](https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/Umetrip-AdBlock-Lite.sgmodule) | [镜像模块](https://gh-proxy.com/https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/Umetrip-AdBlock-Lite.sgmodule) |

在 Surge 的「模块 → 安装新模块」中粘贴上述模块地址。已有同名本地模块时，先停用旧本地模块，再启用远程版本，避免同时运行两份规则。发布到仓库不会自动更改设备上的配置或模块开关。

咪咕模块不依赖脚本或 MITM。航旅纵横模块需要开启重写、脚本、MITM 并信任 Surge 证书；模块自动下载本仓库的 `scripts/Umetrip-AdBlock-Lite.js`，无需另放本地文件。该脚本使用 `gh-proxy.com` 镜像下载；脚本下载时访问镜像服务，过滤逻辑本身不发起网络请求。

## 咪咕视频的范围与限制

精确拦截 `ggc.cmvideo.cn`、`ggv.cmvideo.cn`、`ggic03.miguvideo.com`、`ggmk.miguvideo.com`、`ggadoffline.miguvideo.com` 和 `ggx05.miguvideo.com` 六个域名，不使用根域名或通配符拦截。

前五个域名来自上游公开规则。`ggx05.miguvideo.com` 保留为实验候选：上游对 `ggx` 系列采用 `/request/sdk` 路径规则，不能据此保证整个域名仅承载广告。出现加载或播放异常时停用本模块。

此模块是域名拦截补充，不保证去除所有开屏、品牌画面、倒计时、播放前广告或信息流推广，也不改变会员权限。

## 航旅纵横的范围与限制

- 拒绝 `oss.umetrip.com/fs/advert/polite` 及其子路径。
- 拒绝 `discardrp.umetrip.com`、`startup.umetrip.com` 的 `/gateway/api/umetrip/native` 接口。
- 对 `home.umetrip.com` 及上游公开 HTTP 端点 `114.115.217.129` 的同一接口，仅在唯一的 `rpid` 请求头去除首尾空白后严格等于 `1000002` 或 `1000019` 时返回 404。
- 请求头名称不区分大小写；缺失、冲突、类型异常、未知标识或异常输入均原样放行。

脚本只读取匹配请求的 URL 和请求头，不读取请求正文，不记录、存储或上传数据。当前 App 版本的完整兼容性仍需实机确认，不保证去除所有推广。

## 验证和回退

安装后分别检查 App 启动、正常浏览和常用功能。咪咕需检查视频播放；航旅纵横需检查航班查询、行程展示及其他常用入口。已有广告缓存可能在后续启动时更新。

出现异常时停用对应远程模块；如需恢复旧方案，可重新启用原本地模块。不要同时启用同一 App 的多份过滤模块。发布检查覆盖 Surge 语法、远程脚本依赖与原逻辑一致性，不等同于实机效果验证。

## 上游与许可

上游为 [fmz200/wool_scripts](https://github.com/fmz200/wool_scripts)：

- [Quantumult X 规则合集](https://github.com/fmz200/wool_scripts/blob/main/QuantumultX/rewrite/rewrite.snippet)：咪咕域名、航旅接口范围。
- [航旅纵横广告脚本](https://github.com/fmz200/wool_scripts/blob/main/Scripts/umetrip/umetrip_ads.js)：两个 `rpid` 广告标识。

本仓库将这些规则适配为 Surge 模块；航旅脚本改为请求阶段的严格标识匹配、有限 URL 范围及未知输入放行。以上两个 `.sgmodule` 文件和 `scripts/Umetrip-AdBlock-Lite.js` 按 **GPL-3.0-only** 分发；许可全文见 [GPL-3.0](../LICENSES/GPL-3.0.txt)。该许可声明仅覆盖这里明确列出的文件，不改变其他独立模块的许可。
