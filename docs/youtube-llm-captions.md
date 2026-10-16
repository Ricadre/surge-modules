# YouTube · LLM 翻译字幕

0.1.0 测试版。把 YouTube 字幕请求转交给使用者自己的翻译服务；脚本由模块自动下载。默认目标为简体中文，默认双语。GitHub 仅托管模块与脚本，不提供公共翻译服务或模型额度。

## 安装与参数

- [固定 Raw 模块](https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/YouTube-LLM-Captions.sgmodule)
- [固定镜像模块](https://gh-proxy.com/https://raw.githubusercontent.com/nuvora-f44c84/surge-modules/main/modules/YouTube-LLM-Captions.sgmodule)

在 Surge「模块 → 安装新模块」中粘贴上述地址。需要开启重写、脚本和 MITM，并安装、完全信任 Surge 证书。脚本通过 gh-proxy.com 下载，后续可更新同一个模块，无需另放本地 JS。

| 参数 | 填写方法 |
| --- | --- |
| backend | 已部署且由自己信任的翻译服务域名，例如 translate.example.com；不要填写 https://、路径、端口、账号或密钥。使用 HTTPS 默认端口。 |
| target | 目标语言，默认 zh-Hans；例如 zh-Hant、en。 |
| dual | true 为双语，false 为仅译文；实际输出由后端实现。 |

示例域名为占位符，默认 caption.example.invalid 不会触发字幕转发。参数只保存在安装者的 Surge 模块设置中，不提交到仓库。参数格式错误时脚本放行原请求。

已有 YouTube LLM Caption Proxy v2、旧 Proxy、Translate 或其他同类字幕改写模块时，先停用旧模块，再启用本模块，避免重复转发。发布不自动修改任何设备上的配置、模块开关或参数。

## 流程与后端接口

1. 只处理 www.youtube.com、m.youtube.com 的 /api/timedtext 字幕请求。
2. 当目标语言和请求字幕语言均为中文时，直接放行原请求，不调用翻译后端。字幕语言依次读取 tlang、lang；中文识别兼容 zh、cmn、yue 及语言地区后缀。
3. 其他匹配请求改写到 HTTPS 后端的 /caption 接口，查询参数为 src（URL 编码的原字幕 URL）、target 和 dual。
4. 检查原 YouTube 字幕或配置后端 /caption 的成功响应，仅合并文本完全重复的两行中文字幕。

后端需要接收上述 GET 请求，自行获取字幕、调用模型或读取缓存，并返回 YouTube 可使用的字幕格式及正确的响应头。本仓库不包含后端部署、模型密钥管理、额度或费用设置；这些由后端维护。

去重支持 JSON3 的单文本段字幕，以及 transcript / timedtext XML 的纯文本字幕；保留时间属性、不同的双语文本、多段逐字时间流和未知格式。多行文本、嵌套标签、不合法数据或处理异常时尽量保持原内容。超过模块设置的 2 MiB 响应处理上限时，不保证执行去重。

## 数据范围与限制

翻译后端会收到原始字幕请求 URL，其中可能包含视频标识和临时签名参数，并按服务实现获取字幕。模块沿用请求改写方式，客户端请求头也可能随请求转发，因此应只连接自己信任的后端。脚本不调用其他公共翻译服务，不在日志中记录 URL、字幕内容或凭据。

该模块改写字幕请求，不转发视频或音频流。它不保证覆盖所有 YouTube App 版本、字幕格式或网络行为；后端不可用时，已经改写的字幕请求可能失败，不承诺自动回退原字幕。

出现字幕异常时停用本模块，再启用原有字幕模块；无需删除原本地文件。验证时检查中文直通、外语双语、仅译文及普通视频播放。仓库自动化检查使用合成数据，不替代手机实机验证。

## 实现与参考

Surge 端脚本由本仓库维护。字幕合并逻辑与请求转发逻辑独立；不依赖其他项目的远程字幕脚本。没有将用户私有翻译服务实现作为公共上游发布。

- [Surge 模块与参数](https://manual.nssurge.com/profile/module.html)
- [Surge HTTP 请求脚本](https://manual.nssurge.com/scripting/http-request.html)
- [Surge HTTP 响应脚本](https://manual.nssurge.com/scripting/http-response.html)
