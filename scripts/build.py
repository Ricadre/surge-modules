import argparse
from pathlib import Path

root = Path(__file__).resolve().parent.parent
# Publishing is suspended after an on-device loading failure. Historical jq
# remains in src/ for research and is deliberately excluded from this artifact.
module = """#!name=X 信息流广告过滤（已停用）
#!desc=0.1.0 已反馈启用后 X 无法加载、停用后恢复。0.1.1 已移除全部解密与重写配置，不提供去广告功能。请保持旧版停用，或更新/删除本模块。
#!version=0.1.1
#!homepage=https://github.com/Ricadre/surge-modules

# 此地址保留用于撤回 0.1.0 的配置，不再发布可启用的广告过滤规则。
# 本文件仅含元数据和注释：无 MITM、重写、脚本、域名封锁或分流配置。
# 远程更新不等于手机已应用；在 Surge 中检查版本是否为 0.1.1。
# 若只需要恢复 X，直接停用或删除旧模块即可，无需重新启用测试。
# 本版本不会修改主配置或其他模块中的 MITM 设置。
"""
parser = argparse.ArgumentParser(description="Build the inactive X module withdrawal notice.")
parser.add_argument("--check", action="store_true", help="Check generated module without writing it")
args = parser.parse_args()
output = root / "modules/X-AdFilter-Experimental.sgmodule"
if args.check:
    if not output.exists() or output.read_text() != module:
        raise SystemExit("Generated module is out of date. Run python3 scripts/build.py")
    print("Inactive module matches source")
else:
    output.parent.mkdir(exist_ok=True)
    output.write_text(module)
    print("Created inactive modules/X-AdFilter-Experimental.sgmodule")
