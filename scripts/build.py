import argparse
from pathlib import Path

root = Path(__file__).resolve().parent.parent
expression = " ".join(line.strip() for line in (root / "src/x-ad-filter.jq").read_text().splitlines()
                      if line.strip() and not line.lstrip().startswith("#"))
assert "'" not in expression
pattern = (r"^https://api\.(?:twitter|x)\.com/(?:(?:1\.1/)?graphql/[^/?]+/"
           r"(?:HomeTimeline|HomeLatestTimeline|HomeTimelineLatest|TweetDetail|SearchTimeline|SearchTimelineQuery)"
           r"|2/timeline/(?:home|home_latest)\.json)(?:\?|$)")
module = """#!name=X 信息流广告过滤（实验版）
#!desc=需 Surge iOS 5.14+、开启重写与 MITM 并信任本机证书。仅在 X API 可解密时过滤推广条目；无法绕过 X App 证书锁定，未经过官方 X App 实机验证。若 X 无法加载，请停用本模块。
#!version=0.1.0
#!homepage=https://github.com/Ricadre/surge-modules

# 本地单文件模块，无远程脚本、外发请求或账号凭据。
# 此文件不是“最新版官方 X App 已验证可用”的去广告方案。
# MITM 会让 Surge 在本机读取以下 API 主机的 HTTPS 内容。
# 只改写下列信息流接口；不添加任何分流或域名封锁规则。
# 只识别明确的 promoted 标记，不按推文文字、认证标识或账号名称过滤。
# 未覆盖所有广告类型；接口/结构变化以及 iOS 超过 1 MB 的响应可能无法处理。
# 不要添加 skip-server-cert-verify：它不能解决 App 的证书锁定。

[Body Rewrite]
""" + f"http-response-jq {pattern} '{expression}'\n" + """
[MITM]
hostname = %APPEND% api.twitter.com, api.x.com
"""
parser = argparse.ArgumentParser(description="Build the X experimental Surge module.")
parser.add_argument("--check", action="store_true", help="Check generated module without writing it")
args = parser.parse_args()
output = root / "modules/X-AdFilter-Experimental.sgmodule"
if args.check:
    if not output.exists() or output.read_text() != module:
        raise SystemExit("Generated module is out of date. Run python3 scripts/build.py")
    print("Generated module matches source")
else:
    output.parent.mkdir(exist_ok=True)
    output.write_text(module)
    print("Created modules/X-AdFilter-Experimental.sgmodule")
