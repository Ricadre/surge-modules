"""Build the self-contained, experimental Amap module; no downloaded scripts."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = r"https://(?:m5|m5-x|info)\.amap\.com/{1,2}ws/"
SUFFIX = r"/?(?:\?.*)?$"

# These helpers touch only existing objects/arrays. A completely unfamiliar
# card list passes through; the allowlist activates only with a known anchor.
HELPERS = """
def obj($p; f):
  if (try (getpath($p) | type) catch null) == "object"
  then setpath($p; getpath($p) | f) else . end;
def arr($p; f):
  if (try (getpath($p) | type) catch null) == "array"
  then setpath($p; getpath($p) | f) else . end;
def keep_cards($keys):
  if all(.[]; type == "object" and (.dataKey | type) == "string")
     and any(.[]; .dataKey as $k | $keys | index($k) != null)
  then map(select(.dataKey as $k | $keys | index($k) != null)) else . end;
"""

RULES = [
    ("splash", "开屏广告列表", r"valueadded/alimama/splash_screen", """
      arr(["data", "ad"]; [])
    """),
    ("home", "首页：保留继续导航、常去地点、登录和车辆位置卡片", r"faas/amap-navigation/main-page", """
      obj(["data"];
        arr(["cardList"]; keep_cards(["ContinueNavigationCard", "FrequentLocation", "LoginCard"]))
        | arr(["mapBizList"]; keep_cards(["FindCarVirtualCard"]))
      )
    """),
    ("profile", "我的：精简卡片、去提示与勋章；保留订单、足迹及其他顶层数据", r"shield/dsp/profile/index/nodefaas(?:v3)?", """
      obj(["data"]; del(.tipData, .memberInfo)
        | arr(["cardList"]; keep_cards(["MyOrderCard"]))
      )
    """),
    ("config", "已知推广配置：不删除地图图层、天气或足迹配置", r"shield/frogserver/aocs/updatable/1", """
      obj(["data"];
        ["SplashScreenControl", "amapCoin", "favorites_info", "feedback_banner",
         "home_business_position_config", "hotel_activity", "hotel_loop", "hotel_tipsicon",
         "hotsaleConfig", "landing_page_info", "nearby_business_popup", "operation_layer",
         "small_biz_case", "splashscreen", "splashview_config", "sur_bar", "taxi_activity"] as $slots
        | reduce $slots[] as $slot (.;
            if has($slot) and (.[$slot] | type) == "object"
            then .[$slot] = {"status": 1, "version": "", "value": ""} else . end)
      )
    """),
    ("hotword", "搜索框热榜推广", r"shield/search_bff/hotword", """
      arr(["data", "headerHotWord"]; [])
    """),
    ("marketing", "搜索营销素材", r"shield/search_business/process/marketingOperationStructured", """
      obj(["data"]; del(.commonMaterial, .tipsOperationLocation, .resourcePlacement))
    """),
    ("results", "搜索结果：仅过滤已知广告类型与推广浮条，保留普通地点", r"shield/search_poi/(?:mps|search/sp)", """
      def clean_results:
        map(select((try (.item_type == "brandAdCard" or
                   (.item_type == "ImageBanner" and .card.card_id == "ImageBanner")) catch false) | not)
          | if type == "object" then del(.tips_operation_info) else . end);
      arr(["data", "list_data", "content"]; clean_results)
      | arr(["data", "modules", "not_parse_result", "data", "list_data", "content"]; clean_results)
      | arr(["data", "modules", "list_data", "data", "content"]; clean_results)
    """),
    ("suggestions", "搜索联想：过滤有广告标记的条目，保留普通联想和城市分组", r"shield/search_poi/sug", """
      def clean_tips:
        map(select((try (.tip.datatype_spec == "12" or .tip.result_type == "ad"
                        or .tip.result_type == "poi_ad" or .tip.task_tag == "ad") catch false) | not));
      arr(["tip_list"]; clean_tips)
      | arr(["city_list"]; map(arr(["tip_list"]; clean_tips)))
    """),
    ("banners", "搜索结果上方营销横幅、领券浮条", r"shield/search_poi/tips_operation_location", """
      obj(["data"]; del(.coupon)
        | obj(["modules"]; del(.belt, .common_float_bar, .common_image_banner,
          .coupon_discount_float_bar, .coupon_float_bar, .discount_coupon,
          .image_cover_bar, .mood_coupon_banner, .operation_brand,
          .promotion_wrap_card, .tips_top_banner)))
    """),
]

# Dedicated promotion APIs only. Other map/search/order/navigation requests
# still go upstream. The response is intentionally empty on these two APIs.
LOCAL_PATHS = [r"shield/search/new_hotword", r"shield/search_poi/tips_adv"]


def build():
    lines = [
        "#!name=高德地图推广过滤（测试版）",
        "#!desc=0.1.0 测试版，尚未完成实机验证。处理开屏、首页、搜索及我的推广；首页和我的部分非广告卡片也会隐藏。需 Surge iOS 5.14+、重写、MITM 及已信任证书。先停用其他高德模块。",
        "#!version=0.1.0",
        "#!homepage=https://github.com/Ricadre/surge-modules",
        "",
        "# 安装说明、影响范围及回退方法：docs/amap-ad-filter.txt",
        "# 使用内置 JQ，无外部脚本依赖。仅匹配下列接口，兼容 /ws/ 和 //ws/。",
        "# 页面卡片精简采用保留列表；无法保证所有保留项之外的卡片都属于广告。",
        "# 非 JSON 由 Surge 跳过；未知字段保留；遇到类型错误返回原始 JSON。",
        "[Body Rewrite]",
    ]
    for name, comment, path, expression in RULES:
        expression = " ".join((HELPERS + ". as $original | try (" + expression + ") catch $original").split())
        if "'" in expression:
            raise ValueError("Surge single-quoted expression contains a quote")
        lines += [f"# {name}: {comment}", f"http-response-jq ^{HOST}{path}{SUFFIX} '{expression}'"]
    lines += ["", "[Map Local]", "# 两个独立推广接口返回空对象；不拦截普通搜索、路线、地图、订单接口。"]
    for path in LOCAL_PATHS:
        lines.append(f'^{HOST}{path}{SUFFIX} data-type=text data="{{}}" status-code=200 header="Content-Type:application/json"')
    lines += ["", "[MITM]", "hostname = %APPEND% m5.amap.com, m5-x.amap.com, info.amap.com", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = ROOT / "modules/Amap-AdBlock.sgmodule"
    content = build()
    if args.check:
        if not target.exists() or target.read_text() != content:
            raise SystemExit("Run python3 scripts/build_amap.py")
        print("Amap module matches source")
    else:
        target.write_text(content)
        print(f"Created {target.relative_to(ROOT)}")
