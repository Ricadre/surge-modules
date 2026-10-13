import copy
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
module = (root / "modules/X-AdFilter-Experimental.sgmodule").read_text()
# Regression guard: a normal build must not restore the withdrawn interception.
active_lines = [line for line in module.splitlines()
                if line.strip() and not line.lstrip().startswith("#")]
assert active_lines == [], active_lines
assert "#!version=0.1.1" in module
assert "已停用" in module and "不提供去广告功能" in module
print("PASS published 0.1.1 has no active configuration directives")

# The remaining checks cover historical research logic only, not the published
# module. Passing them does not demonstrate iPhone or X App compatibility.
jq_filter = (root / "src/x-ad-filter.jq").read_text()


def run(value):
    result = subprocess.run(["jq", "-c", jq_filter], input=json.dumps(value),
                            text=True, capture_output=True, check=True)
    lines = result.stdout.splitlines()
    assert len(lines) == 1, result.stdout
    return json.loads(lines[0])


def check(name, original, expected):
    actual = run(original)
    assert actual == expected, (name, actual, expected)
    assert run(actual) == expected, f"Not idempotent: {name}"
    print(f"PASS {name}")


organic = {"entryId": "tweet-123", "sortIndex": "1900000000000000001",
           "content": {"itemContent": {"tweet_results": {"result": {
               "rest_id": "1897000000000000123", "legacy": {"full_text": "promoted 广告 ad"}}}}}}
cursor = {"entryId": "cursor-bottom-0", "content": {"cursorType": "Bottom", "value": "ABC=="}}
ad_id = {"entryId": "promoted-tweet-999", "content": {"itemContent": {}}}
ad_meta = {"entryId": "tweet-999", "content": {"itemContent": {"promotedMetadata": {}}}}
null_meta = {"entryId": "tweet-124", "content": {"itemContent": {"promotedMetadata": None}}}
false_meta = {"entryId": "tweet-125", "content": {"itemContent": {"promotedMetadata": False}}}


def timeline(instructions):
    return {"data": {"home": {"home_timeline_urt": {"instructions": instructions}}},
            "extensions": {"untouched": True}}


check("home ads removed; posts/cursor/order preserved",
      timeline([{"type": "TimelineAddEntries", "entries": [organic, ad_id, ad_meta, null_meta, false_meta, cursor]}]),
      timeline([{"type": "TimelineAddEntries", "entries": [organic, null_meta, false_meta, cursor]}]))

nested_good = {"entryId": "tweet-2", "item": {"itemContent": {"text": "ordinary reply"}}}
nested_ad = {"entryId": "tweet-3", "item": {"itemContent": {"promotedMetadata": {"x": 1}}}}
mixed = {"entryId": "conversation-1", "content": {"items": [nested_ad, nested_good]}}
empty_after = {"entryId": "conversation-2", "content": {"items": [nested_ad]}}
already_empty = {"entryId": "conversation-3", "content": {"items": []}}
check("mixed replies retained; ad-only module removed",
      timeline([{"entries": [mixed, empty_after, already_empty, cursor]}]),
      timeline([{"entries": [{"entryId": "conversation-1", "content": {"items": [nested_good]}}, already_empty, cursor]}]))

check("module append filters only promoted items",
      timeline([{"type": "TimelineAddToModule", "moduleEntryId": "conversation-1", "moduleItems": [nested_good, nested_ad]}]),
      timeline([{"type": "TimelineAddToModule", "moduleEntryId": "conversation-1", "moduleItems": [nested_good]}]))

check("replacement ads dropped; cursor instructions retained",
      timeline([{"type": "TimelineReplaceEntry", "entry": ad_meta}, {"type": "TimelineReplaceEntry", "entry": cursor},
                {"type": "TimelineTerminateTimeline", "direction": "Bottom"}]),
      timeline([{"type": "TimelineReplaceEntry", "entry": cursor}, {"type": "TimelineTerminateTimeline", "direction": "Bottom"}]))

legacy_ad = {"entryId": "tweet-99", "content": {"item": {"content": {"tweet": {"promotedMetadata": {"x": 1}}}}}}
check("legacy instruction wrappers",
      {"timeline": {"instructions": [{"addEntries": {"entries": [organic, legacy_ad, cursor]}},
                                     {"replaceEntry": {"entry": ad_id}}]}},
      {"timeline": {"instructions": [{"addEntries": {"entries": [organic, cursor]}}]}})

quoted_post = copy.deepcopy(organic)
quoted_post["content"]["itemContent"]["tweet_results"]["result"]["quoted_status_result"] = {
    "result": {"promotedMetadata": {"quoted": True}}}
unrelated = {"data": {"items": [ad_id], "entries": [ad_meta]}, "errors": [{"message": "ad"}]}
check("unrelated arrays unchanged", unrelated, unrelated)
check("ordinary post quoting promoted content retained",
      timeline([{"entries": [quoted_post, cursor]}]), timeline([{"entries": [quoted_post, cursor]}]))

malformed = timeline([None, "future", {"entries": None}, {"entries": [None, 1, "ad", {}, cursor]}])
check("unknown/nullable shapes preserved", malformed, malformed)

large_id = {"data": {"id": 1897000000000000123, "id_str": "1897000000000000123"}}
check("large untouched IDs preserved by local jq", large_id, large_id)

for value in [None, [], {}, {"errors": [{"code": 32, "message": "Could not authenticate"}]}]:
    check("non-timeline payload preserved", value, value)

print("Historical JSON checks only; published 0.1.1 performs no ad filtering.")
