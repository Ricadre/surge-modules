"""Synthetic contract checks, not a claim of iOS/App compatibility."""
import copy
import json
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parent.parent
module = (ROOT / "modules/Amap-AdBlock.sgmodule").read_text()
rules = {}
for line in module.splitlines():
    if line.startswith("# ") and ": " in line:
        name = line[2:].split(": ", 1)[0]
    if line.startswith("http-response-jq "):
        _, pattern, quoted = line.split(" ", 2)
        expression, = shlex.split(quoted)
        rules[name] = (pattern, expression)

endpoints = {
    "splash": "valueadded/alimama/splash_screen",
    "home": "faas/amap-navigation/main-page",
    "profile": "shield/dsp/profile/index/nodefaasv3",
    "config": "shield/frogserver/aocs/updatable/1",
    "hotword": "shield/search_bff/hotword",
    "marketing": "shield/search_business/process/marketingOperationStructured",
    "results": "shield/search_poi/mps",
    "suggestions": "shield/search_poi/sug",
    "banners": "shield/search_poi/tips_operation_location",
}
assert set(rules) == set(endpoints)
local_patterns = [line.split(" ", 1)[0] for line in module.splitlines()
                  if line.startswith("^https://")]
assert len(local_patterns) == 2
for name, path in endpoints.items():
    pattern = rules[name][0]
    for host in ("m5", "m5-x", "info"):
        for slashes in ("/", "//"):
            for suffix in ("", "/", "?key=value", "/?key=value"):
                assert re.search(pattern, f"https://{host}.amap.com{slashes}ws/{path}{suffix}")
    for suffix in ("_other", "/other", "evil"):
        assert not re.search(pattern, f"https://m5.amap.com/ws/{path}{suffix}")
    for url in (f"https://m5.amap.com.example.org/ws/{path}",
                f"https://other.amap.com/ws/{path}", f"https://m5.amap.com///ws/{path}"):
        assert not re.search(pattern, url)

assert re.search(rules["profile"][0], "https://m5.amap.com/ws/shield/dsp/profile/index/nodefaas")
assert re.search(rules["results"][0], "https://m5.amap.com/ws/shield/search_poi/search/sp")
for pattern, path in zip(local_patterns, ("shield/search/new_hotword", "shield/search_poi/tips_adv")):
    assert re.search(pattern, "https://m5.amap.com/ws/" + path + "?test=1")
    assert not re.search(pattern, "https://m5.amap.com/ws/" + path + "/other")

for path in ("perception/drive/routeInfo", "perception/drive/routePlan", "bus/plan/integrate",
             "shield/search_poi/ordinary_search", "shield/search_business/process/orderList",
             "shield/search/poi/detail", "valueadded/weather/v2", "msgbox/pull",
             "faas/amap-navigation/main-page-assets", "mapapi/hint_text/offline_data"):
    assert not any(re.search(p, "https://m5.amap.com/ws/" + path + "?test=1")
                   for p in [r[0] for r in rules.values()] + local_patterns), path
print("PASS URL boundaries, alternate paths, functional endpoints excluded")


def run(name, payload):
    result = subprocess.run(["jq", "-c", rules[name][1]], input=json.dumps(payload),
                            text=True, capture_output=True, check=True)
    lines = result.stdout.splitlines()
    assert len(lines) == 1, (name, result.stdout)
    return json.loads(lines[0])


def check(name, original, expected):
    assert run(name, original) == expected, (name, run(name, original), expected)
    assert run(name, expected) == expected, (name, "not idempotent")


check("splash", {"code": 1, "data": {"ad": [{"creative": [{}]}], "settings": 123}},
      {"code": 1, "data": {"ad": [], "settings": 123}})
home = {"data": {"cardList": [{"dataKey": "ContinueNavigationCard", "route": "keep"},
                              {"dataKey": "FrequentLocation"}, {"dataKey": "LoginCard"},
                              {"dataKey": "ExamplePromotion"}],
                 "mapBizList": [{"dataKey": "FindCarVirtualCard"}, {"dataKey": "ExamplePromotion"}],
                 "map": {"keep": True}}, "code": 1}
expected = copy.deepcopy(home)
expected["data"]["cardList"].pop()
expected["data"]["mapBizList"].pop()
check("home", home, expected)
unknown_cards = {"data": {"cardList": [{"dataKey": "UnknownVersionCard"}],
                          "mapBizList": [None, {"dataKey": "FindCarVirtualCard"}]}}
check("home", unknown_cards, unknown_cards)
profile = {"data": {"tipData": {}, "memberInfo": {}, "footPrintV2": {"keep": True},
                    "topMixedCard": {"keep": True}, "favorites": ["keep"],
                    "cardList": [{"dataKey": "MyOrderCard", "orders": ["keep"]},
                                 {"dataKey": "ExamplePromotion"}]}}
expected = copy.deepcopy(profile)
del expected["data"]["tipData"], expected["data"]["memberInfo"]
expected["data"]["cardList"].pop()
check("profile", profile, expected)
check("config", {"data": {"splashscreen": {"value": "ad"}, "operation_layer": {"value": "ad"},
                           "maplayers": {"keep": 1}, "map_weather_switch": {"keep": 1},
                           "footprint": {"keep": 1}, "hotel_loop": "unknown"}},
      {"data": {"splashscreen": {"status": 1, "version": "", "value": ""},
                "operation_layer": {"status": 1, "version": "", "value": ""},
                "maplayers": {"keep": 1}, "map_weather_switch": {"keep": 1},
                "footprint": {"keep": 1}, "hotel_loop": "unknown"}})
check("hotword", {"data": {"headerHotWord": ["ad"], "history": ["keep"]}},
      {"data": {"headerHotWord": [], "history": ["keep"]}})
check("marketing", {"data": {"commonMaterial": [], "tipsOperationLocation": {},
                              "resourcePlacement": {}, "other": "keep"}, "code": 1},
      {"data": {"other": "keep"}, "code": 1})

ordinary = {"item_type": "poi", "name": "含广告二字的正常地点", "id": "keep",
            "card": {"card_id": "SearchCardBrand"}, "tips_operation_info": {"ad": True}}
kept = copy.deepcopy(ordinary)
del kept["tips_operation_info"]
unknown = {"item_type": "FutureCard", "card": {"card_id": "ImageBanner"}}
ads = [{"item_type": "brandAdCard"}, {"item_type": "ImageBanner", "card": {"card_id": "ImageBanner"}}]
for path in (("data", "list_data", "content"),
             ("data", "modules", "not_parse_result", "data", "list_data", "content"),
             ("data", "modules", "list_data", "data", "content")):
    def wrap(value):
        for key in reversed(path):
            value = {key: value}
        return value
    check("results", wrap([ordinary, *ads, unknown, None, 42]), wrap([kept, unknown, None, 42]))

tip = {"tip": {"result_type": "poi", "name": "正常地址", "task_tag": "ordinary"}}
advertised = [{"tip": {"datatype_spec": "12"}}, {"tip": {"result_type": "ad"}},
              {"tip": {"result_type": "poi_ad"}}, {"tip": {"task_tag": "ad"}}]
check("suggestions", {"tip_list": [tip, *advertised, None, "future"],
                       "city_list": [{"city": "test", "tip_list": [tip, *advertised]}, None]},
      {"tip_list": [tip, None, "future"], "city_list": [{"city": "test", "tip_list": [tip]}, None]})
check("banners", {"data": {"coupon": {}, "modules": {"common_image_banner": {},
                                                       "tips_top_banner": {}, "poi": "keep"}}},
      {"data": {"modules": {"poi": "keep"}}})
print("PASS all filters, metadata and functional data preserved, idempotence")

for name in rules:
    for value in (None, [], "unknown", 3, {}, {"error": "unauthorized"}, {"data": None},
                  {"data": "unknown"}, {"data": []}, {"data": {"unknown": "keep"}},
                  {"data": {"cardList": [None], "ad": {}, "modules": "unknown"}}):
        assert run(name, value) == value, (name, value)
assert "[Script]" not in module and "[Rule]" not in module
assert "*.amap.com" not in module and "skip-server-cert-verify" not in module
assert "hostname = %APPEND% m5.amap.com, m5-x.amap.com, info.amap.com" in module
print("PASS unknown responses preserved; no external scripts or broad host blocking")
print("Local checks only. On-device filtering and normal loading remain unverified.")
