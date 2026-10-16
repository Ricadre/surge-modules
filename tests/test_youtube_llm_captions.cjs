const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../scripts/YouTube-LLM-Captions.js"), "utf8");
const settings = "backend=translate.example.com&target=zh-Hans&dual=true";
const english = "https://www.youtube.com/api/timedtext?lang=en&v=synthetic-video";
const duplicate = JSON.stringify({ events: [{ tStartMs: 20, segs: [{ utf8: "合成字幕\n合成字幕" }] }] });

function run({ url = english, argument = settings, response } = {}) {
  let result, calls = 0;
  const context = {
    $request: { url }, $argument: argument, console: { log() {} },
    $done(value) { result = JSON.parse(JSON.stringify(value)); calls++; }
  };
  if (response !== undefined) context.$response = response;
  vm.runInNewContext(source, context, { timeout: 1000 });
  assert.equal(calls, 1);
  return result;
}

test("foreign subtitles use only the configured HTTPS backend and preserve the source URL", () => {
  const result = new URL(run().url);
  assert.equal(result.origin, "https://translate.example.com");
  assert.equal(result.pathname, "/caption");
  assert.equal(result.searchParams.get("src"), english);
  assert.equal(result.searchParams.get("target"), "zh-Hans");
  assert.equal(result.searchParams.get("dual"), "true");
});

test("Chinese subtitles bypass the backend for a Chinese target", () => {
  for (const lang of ["zh", "zh-Hans", "zh_TW", "cmn", "yue-Hant"]) {
    assert.deepEqual(run({ url: english.replace("lang=en", "lang=" + lang) }), {});
  }
  assert.deepEqual(run({ url: english + "&tlang=zh-Hans" }), {});
});

test("non-Chinese targets and translation-only output are passed to the backend", () => {
  const result = new URL(run({
    url: english.replace("lang=en", "lang=zh-Hans"),
    argument: "backend=translate.example.com&target=en&dual=false"
  }).url);
  assert.equal(result.searchParams.get("target"), "en");
  assert.equal(result.searchParams.get("dual"), "false");
});

test("missing, placeholder, malformed and looping backend settings never reroute", () => {
  for (const backend of ["", "caption.example.invalid", "https://translate.example.com",
    "translate.example.com/path", "translate.example.com:8443", "user@translate.example.com",
    "*.example.com", "www.youtube.com", "bad..example.com", "%ZZ"]) {
    assert.deepEqual(run({ argument: "backend=" + backend }), {}, backend);
  }
  assert.deepEqual(run({ argument: settings.replace("dual=true", "dual=maybe") }), {});
});

test("other sites and adjacent YouTube paths remain unchanged", () => {
  for (const url of ["https://www.youtube.com/watch?v=synthetic-video",
    "https://www.youtube.com.example.com/api/timedtext?lang=en",
    "https://translate.example.com/caption?src=synthetic",
    "https://www.youtube.com/api/timedtext-extra?lang=en"]) {
    assert.deepEqual(run({ url }), {});
  }
});

test("JSON3 duplicate Chinese lines collapse while timing is retained", () => {
  const data = JSON.parse(run({ response: { status: 200, body: duplicate } }).body);
  assert.equal(data.events[0].segs[0].utf8, "合成字幕");
  assert.equal(data.events[0].tStartMs, 20);
});

test("configured backend response is handled; lookalike hosts and paths are not", () => {
  const response = { status: 200, body: duplicate };
  assert.ok(run({ url: "https://translate.example.com/caption?src=synthetic", response }).body);
  for (const url of ["https://translateXexample.com/caption?src=synthetic",
    "https://translate.example.com.evil.example/caption?src=synthetic",
    "https://translate.example.com/caption-extra?src=synthetic",
    "https://other.example.com/caption?src=synthetic",
    "http://translate.example.com/caption?src=synthetic"]) {
    assert.deepEqual(run({ url, response }), {}, url);
  }
});

test("different bilingual lines and multiple timed segments are preserved", () => {
  for (const segs of [[{ utf8: "Synthetic caption\n合成字幕" }],
    [{ utf8: "合成字幕" }, { utf8: "\n合成字幕" }]]) {
    assert.deepEqual(run({ response: { status: 200, body: JSON.stringify({ events: [{ segs }] }) } }), {});
  }
});

test("XML deduplication retains timestamps and entity encoding", () => {
  const body = '<transcript><text start="1" dur="2">合成&amp;字幕<br/>合成&amp;字幕</text></transcript>';
  assert.equal(run({ response: { status: 200, body } }).body,
    '<transcript><text start="1" dur="2">合成&amp;字幕</text></transcript>');
});

test("unknown formats, malformed responses and non-success statuses pass through", () => {
  for (const body of ["", "{invalid", '{"other":"synthetic"}', "<html>synthetic</html>",
    '<timedtext><p><s>合成</s><br/><s>合成</s></p></timedtext>']) {
    assert.deepEqual(run({ response: { status: 200, body } }), {});
  }
  assert.deepEqual(run({ response: { status: 403, body: duplicate } }), {});
});
