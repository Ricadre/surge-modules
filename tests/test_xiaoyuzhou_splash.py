"""Check that the published splash rule excludes ordinary podcast operations."""
import json
from pathlib import Path
import re
import shlex

module = (Path(__file__).resolve().parent.parent /
          "modules/Xiaoyuzhou-Splash-AdBlock.sgmodule").read_text()
sections = {}
section = None
for line in module.splitlines():
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    if line.startswith('['):
        section = line
        sections[section] = []
    else:
        sections[section].append(line)

assert set(sections) == {'[Map Local]', '[MITM]'}
rule, = sections['[Map Local]']
pattern, parameters = rule.split(' ', 1)
base = 'https://api.xiaoyuzhoufm.com'
for suffix in ('', '/', '?platform=ios', '/?test=1'):
    assert re.search(pattern, base + '/v1/flash-screen/list' + suffix)
for path in (
    '/v1/discovery-feed/list', '/v1/search/get-preset', '/v1/search/search',
    '/v1/podcast/get', '/v1/episode/get', '/v1/subscription/list',
    '/v1/user/get', '/v1/flash-screen/list-extra', '/v1/flash-screen/list/item',
    '/v1/flash-screen/detail', '/v2/flash-screen/list',
):
    assert not re.search(pattern, base + path), path
for host in ('api.xiaoyuzhoufm.com.example.org', 'www.xiaoyuzhoufm.com',
             'media.xyzcdn.net'):
    assert not re.search(pattern, 'https://' + host + '/v1/flash-screen/list'), host
assert not re.search(pattern, base + '/v1/search?q=/v1/flash-screen/list')
options = dict(part.split('=', 1) for part in shlex.split(parameters))
assert options['data-type'] == 'text'
assert options['status-code'] == '200'
assert json.loads(options['data']) == {}
assert options['header'] == 'Content-Type:application/json'
assert sections['[MITM]'] == ['hostname = %APPEND% api.xiaoyuzhoufm.com']
print('PASS: splash URL boundaries, ordinary podcast endpoints excluded, local JSON response, one MITM host')
