# Surge 模块

个人维护的 Surge 模块集合。远程模块统一放在 `modules/`，后续模块也放在这里。

## X 模块已停用

X 实验模块存在正常加载兼容性问题，不建议用于官方 X App；出现异常时停用模块并重新启动 App。

同一远程地址现发布 **0.1.1 停用版**，仅保留元数据与说明，已移除所有 MITM、重写和其他生效配置，**不提供去广告功能**。源文件与历史提交保留用于研究。

| 模块 | 当前状态 | 远程地址 |
| --- | --- | --- |
| X 信息流广告过滤 | 0.1.1 · 已停用，无过滤功能 | [停用版 Raw 文件](https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule) |

## 已安装用户

1. 在 Surge 中停用“X 信息流广告过滤（实验版）”，彻底退出并重新打开 X。
2. 可以直接删除模块；也可以在 Surge 中更新同一远程地址，确认内容为 `#!version=0.1.1`，显示名称为“X 信息流广告过滤（已停用）”。无需重新启用测试。
3. 发布新版不等于手机已经更新；没有获取到 0.1.1 时，请继续保持旧模块停用。停用版本不会改动主配置或其他模块中的 MITM 设置。

远程地址继续保留，便于已有安装获取撤回版本：

```text
https://raw.githubusercontent.com/Ricadre/surge-modules/main/modules/X-AdFilter-Experimental.sgmodule
```

详细记录见[问题与恢复说明](docs/x-ad-filter.txt)。目前没有已验证适用于该用户官方 X App 的去广告模块。

## 已知情况

X 实验模块存在正常加载兼容性问题，不建议用于官方 X App；出现异常时停用模块并重新启动 App。

Surge 官方说明[启用 MITM 可能中断采用证书锁定的 App 连接](https://manual.nssurge.com/http/mitm.html)，并在[主机列表示例](https://manual.nssurge.com/profile/host-list.html)中排除了 Twitter。`skip-server-cert-verify` 不能解决 App 拒绝 Surge 证书的问题。

过去的 JSON 样本测试仅验证过滤表达式，无法证明原生 App 可以解密或实际可用。

## 目录与维护

```text
modules/   远程发布文件（X 当前仅为停用说明）
src/       历史过滤逻辑，不进入当前发布文件
scripts/   生成当前停用版模块
tests/    发布文件停用检查与历史 JSON 样本测试
docs/     模块说明
```

```sh
python3 scripts/build.py
python3 scripts/build.py --check
python3 tests/test_x_ad_filter.py
```

构建只需 Python 3；历史样本测试还需 jq 1.7+。构建器不会将 `src/x-ad-filter.jq` 重新发布为活动规则。测试检查当前模块不包含任何生效配置行。

新增模块使用独立文件和说明，保持远程路径稳定；未经目标 App 实机验证的方案，不应在默认安装路径启用 MITM。不要将个人代理配置、Cookie、令牌、证书或私钥放入此公开仓库。

## 参考

- [Surge 模块机制](https://manual.nssurge.com/profile/module.html)
- [Surge JQ Body Rewrite](https://manual.nssurge.com/http/body-rewrite.html)
- [公开的 X 网页版广告条目结构参考](https://github.com/5jwoj/Surge/tree/main/X)
- [NeoFreeBird 的 App 内广告处理](https://github.com/NeoFreeBird/app/blob/eb25822b451f27f512a5bb9e4fc5eb742b46e54b/src/Hooks/Ads.x)：原生 App Hook 无法直接移植为 Surge 规则。

历史过滤表达式独立实现，未复制或加载上述项目的脚本。
