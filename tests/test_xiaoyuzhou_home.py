"""Keep recommendations intact while removing explicitly marked banner promotions."""
import copy
import json
from pathlib import Path
import re
import shlex
import subprocess

module = (Path(__file__).resolve().parent.parent /
          "modules/Xiaoyuzhou-Splash-AdBlock.sgmodule").read_text()
rules = [line for line in module.splitlines() if line.startswith('http-response-jq ')]
rule, = rules
kind, pattern, quoted_expression = rule.split(' ', 2)
expression, = shlex.split(quoted_expression)
base = 'https://api.xiaoyuzhoufm.com'
for suffix in ('', '/', '?platform=ios', '/?page=2'):
    assert re.search(pattern, base + '/v1/discovery-feed/list' + suffix)
for path in ('/v1/discovery-feed/list-extra', '/v2/discovery-feed/list',
             '/v1/discovery-episode-recommend/list', '/v1/related-episode/list',
             '/v1/subscription/list', '/v1/search/search', '/v1/episode/get',
             '/v1/playback-progress/update', '/v1/operation-resource/list'):
    assert not re.search(pattern, base + path), path
assert not re.search(pattern, base + '.example.org/v1/discovery-feed/list')


def rewrite(value):
    result = subprocess.run(['jq', '-c', expression], input=json.dumps(value),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


# All examples are synthetic; no personal captures or real identifiers are stored.
ordinary = [
    {'type': 'DISCOVERY_HEADER', 'data': [{'url': 'cosmos://page.cos/category'},
         {'url': 'cosmos://page.cos/payPodcastRecommendation/example'}]},
    {'type': 'DISCOVERY_EPISODE_RECOMMEND_V3', 'data': {'target': [{'episode': {'title': 'normal'}}],
         'sessionKey': 'synthetic', 'loadMoreKey': 'next-recommendations'}},
    {'type': 'EDITOR_PICK', 'data': {'picks': [{'episode': {'title': 'editor'}}]}},
    {'type': 'TOP_LIST', 'data': [{'items': ['normal']}]},
    {'type': 'NEW_POWER', 'data': {'items': ['normal']}},
    {'type': 'DISCOVERY_COLLECTION', 'data': [{'title': 'normal'}]},
    {'type': 'FUTURE_BLOCK', 'data': [{'presetPurpose': 'OPERATIONAL'}]},
]
unmarked = {'type': 'EDITORS_PICK_BANNER', 'voiceover': 'editorial', 'showAdIndicator': False}
promoted = {'type': 'EDITORS_PICK_BANNER', 'presetPurpose': 'OPERATIONAL', 'showAdIndicator': False}
advert = {'type': 'EDITORS_PICK_BANNER', 'showAdIndicator': True}
original = {'data': ordinary + [{'type': 'DISCOVERY_BANNER', 'data': [unmarked, promoted, advert]}],
            'loadMoreKey': 'next-page', 'extra': {'unchanged': True}}
expected = copy.deepcopy(original)
expected['data'][-1]['data'] = [unmarked]
assert rewrite(original) == expected
only_promo = {'data': ordinary + [{'type': 'DISCOVERY_BANNER', 'data': [promoted]}],
              'loadMoreKey': 'next-page'}
assert rewrite(only_promo) == {'data': ordinary, 'loadMoreKey': 'next-page'}
assert rewrite({'data': ordinary}) == {'data': ordinary}
for value in (None, [], 'text', 1, {}, {'data': None}, {'data': {}},
              {'data': [None, 1, 'text', {}, {'type': 'DISCOVERY_BANNER', 'data': {}}]},
              {'data': [{'type': 'DISCOVERY_BANNER', 'data': [None, 1, 'text', {}]}]}):
    assert rewrite(value) == value, value
assert rewrite(rewrite(original)) == rewrite(original)
print('PASS: marked promotions removed; recommendations, entries, unmarked banners, unknown schemas and pagination preserved')
