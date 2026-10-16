"""Build the self-contained, experimental Amap module; no downloaded scripts."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = r"https://(?:m5|m5-x|info)\.amap\.com/{1,2}ws/"
SUFFIX = r"/?(?:\?.*)?$"

# Touch only existing objects/arrays; keep unknown cards and normal functions.
HELPERS = """
def obj($p; f):
  if (try (getpath($p) | type) catch null) == "object"
  then setpath($p; getpath($p) | f) else . end;
def arr($p; f):
  if (try (getpath($p) | type) catch null) == "array"
  then setpath($p; getpath($p) | f) else . end;
"""

RULES = [
    ("splash", "开屏广告列表", r"valueadded/alimama/splash_screen", """
      arr(["data", "ad"]; [])
    """),
    ("profile", "我的：按接口字段清理推广，保留足迹、服务入口、语音车标、好友和勋章", r"shield/dsp/profile/index/nodefaas(?:v3)?", """
      def is_card($key): type == "object" and .dataKey == $key and .dataType == $key;
      def is_promotion:
        is_card("MineMemberRecommendTaskCardV2") or is_card("PopularActivitiesCardV5")
        or is_card("PopularActivitiesCardV2") or is_card("ContentCenterFeedCard");
      def clean_entrances:
        map(select((try ((.id == 30 or .id == "30") and .title == "借钱") catch false) | not));
      arr(["data", "cardList"];
        map(select((try is_promotion catch false) | not)
          | if type != "object" then .
            elif is_card("MineNewFootprintCard") then obj(["content"]; del(.operation_resource))
            elif is_card("MineNewVirtualAssetCardV3") then
              arr(["content", "ownedList"]; map(obj([]; del(.bottomTips))))
            elif is_card("MineNewBEntranceCardV4") then
              arr(["content", "entranceList_1"]; clean_entrances)
              | arr(["content", "entranceList_2"]; clean_entrances)
            else . end))
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
        "#!desc=0.2.0 测试版。按接口结构清理我的任务、活动、推荐流、借钱及卡片内推广；保留订单收藏钱包足迹等功能。取消旧卡片白名单。需 Surge iOS 5.14+、重写、MITM 及已信任证书。先停用其他高德模块。",
        "#!version=0.2.0",
        "#!homepage=https://github.com/nuvora-f44c84/surge-modules",
        "",
        "# 安装说明、影响范围及回退方法：docs/amap-ad-filter.txt",
        "# 使用内置 JQ，无外部脚本依赖。仅匹配下列接口，兼容 /ws/ 和 //ws/。",
        "# 根据个人主页接口结构过滤推广，未知卡片原样保留。",
        "# 不再对首页或我的使用仅保留订单/导航的白名单；正常服务入口优先保留。",
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
