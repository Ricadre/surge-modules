# Surge 模块

个人维护的 Surge 模块集合。可安装的文件统一放在 `modules/`，后续模块也放在这里，并在下表登记。

## 模块列表

| 模块 | 版本与状态 | 要求 | 安装地址 |
| --- | --- | --- | --- |
| X 信息流广告过滤 | 0.1.0 · 实验版，未实机验证 | Surge iOS 5.14+；重写与 MITM | [Raw 模块](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule) |

## 远程安装

在 Surge 的模块页面选择“安装新模块”，粘贴以下地址，下载后启用：

```text
https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule
```

如之前安装过同名本地模块，先停用本地版本。该地址跟随 `main` 分支更新；发布新版时保持文件路径不变，在 Surge 中更新模块即可获取。实际刷新时机取决于 Surge 的更新设置与缓存。

X 模块还需要开启重写和 HTTPS 解密（MITM），安装并信任自己在 Surge 中生成的证书。详细操作见[安装与排错说明](docs/x-ad-filter.txt)。

## X 模块的适用范围

这是基于可解密的信息流 JSON 制作的实验模块，**尚未在最新版官方 X App 上验证，不能绕过证书锁定**。Surge 官方的[主机列表示例](https://manual.nssurge.com/profile/host-list.html)将 Twitter 列在因证书锁定而排除 MITM 的主机中。若启用后 X 无法加载，请停用模块。

模块在本机过滤明确带有推广标记的条目，保留普通推文和分页游标；不加载外部脚本，不包含账号凭据，不改动代理分流。MITM 仅追加 `api.twitter.com` 与 `api.x.com`，响应修改只匹配模块列出的信息流接口。

本地构造样本测试涵盖普通条目保留、嵌套广告、替换条目、未知结构与接口匹配范围。它们不能证明真实 App 可用。视频广告、其他接口、服务端结构变化，以及超过 Surge iOS 重写大小限制的响应可能不被处理。

## 目录与维护

```text
modules/   可直接远程安装的 .sgmodule 文件
src/       可读的过滤逻辑源文件
scripts/   模块生成工具
tests/     本地样本测试
docs/      各模块的说明
```

修改 X 模块时，编辑 `src/x-ad-filter.jq` 或 `scripts/build.py`，随后运行：

```sh
python3 scripts/build.py
python3 scripts/build.py --check
python3 tests/test_x_ad_filter.py
```

构建只需 Python 3；测试还需 jq 1.7+。测试执行实际生成的模块内表达式。发布时一起提交源文件、生成的模块和相关说明；逻辑更新需同步调整版本号。

新增模块使用独立文件和说明，保持安装路径稳定。不要将个人代理配置、Cookie、Authorization、令牌、证书或私钥放入此公开仓库。

## 参考

- [Surge 模块](https://manual.nssurge.com/profile/module.html)
- [Surge JQ Body Rewrite](https://manual.nssurge.com/http/body-rewrite.html)
- [Surge HTTPS 解密与证书锁定](https://manual.nssurge.com/http/mitm.html)
- [公开的 X 网页版广告条目结构参考](https://github.com/5jwoj/Surge/tree/main/X)
- [NeoFreeBird 的 App 内广告处理](https://github.com/NeoFreeBird/app/blob/eb25822b451f27f512a5bb9e4fc5eb742b46e54b/src/Hooks/Ads.x)：作为后续研究参考，其原生 App Hook 不能直接用于 Surge。

本仓库的过滤表达式独立实现，未复制或加载上述项目的脚本。
