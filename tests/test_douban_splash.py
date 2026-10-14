"""Check the published filter's URL scope and response compatibility, using synthetic data."""
import json
from pathlib import Path
import re
import shlex
import subprocess

root = Path(__file__).resolve().parent.parent
module = (root / "modules/Douban-Splash-AdBlock.sgmodule").read_text()
rule = next(line for line in module.splitlines() if line.startswith("http-response-jq "))
_, pattern, quoted_expression = rule.split(" ", 2)
expression, = shlex.split(quoted_expression, posix=True)
for path in ("splash", "splash_preload", "splash_preload?test=1", "splash/"):
    assert re.search(pattern, "https://api.douban.com/v2/app_ads/" + path)
for url in (
    "https://api.douban.com/v2/app_ads/feed",
    "https://api.douban.com/v2/app_ads/splash_other",
    "https://api.douban.com/v2/app_ads/splash_preload/other",
    "https://api.douban.com/v2/user/me",
    "https://frodo.douban.com/api/v2/subject_collection/movie_showing/items",
    "https://api.douban.com.example.org/v2/app_ads/splash_preload",
):
    assert not re.search(pattern, url), url

def run(value):
    result = subprocess.run(["jq", "-c", expression], input=json.dumps(value),
                            text=True, capture_output=True, check=True)
    assert len(result.stdout.splitlines()) == 1
    return json.loads(result.stdout)

value = {"ads": [{"ad_place": ["splash_screen", "splash_resume"], "ad_duration": 5000}],
         "preload_ids": ["synthetic-cache-id"], "settings": {"keep": True}}
expected = {"ads": [], "preload_ids": None, "settings": {"keep": True}}
assert run(value) == expected
assert run(expected) == expected
assert run({"ads": [{"ad_id": "sample"}]}) == {"ads": []}
for value in (None, [], "unexpected", 1, {}, {"error": "unauthorized"},
              {"ads": None, "preload_ids": ["keep"]}, {"ads": {"unknown": True}}):
    assert run(value) == value
assert "hostname = %APPEND% api.douban.com" in module
assert "[Rule]" not in module and "[Script]" not in module
print("PASS: endpoint boundaries, empty ads, cache IDs, preserved metadata and unknown responses")
