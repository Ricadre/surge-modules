/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Umetrip: header-only filter adapted from fmz200/wool_scripts.
 * Source: https://github.com/fmz200/wool_scripts/blob/main/Scripts/umetrip/umetrip_ads.js
 * Changes: exact identifiers, bounded URL, case-insensitive header names,
 * and passthrough on unknown input. No body access, logging, storage or network calls.
 * License and attribution: docs/lite-adblocks.md and LICENSES/GPL-3.0.txt.
 */
(function () {
  var result = {};
  try {
    var request = typeof $request === "object" && $request ? $request : {};
    var url = typeof request.url === "string" ? request.url : "";
    var endpoint = /^(?:https?:\/\/home\.umetrip\.com|http:\/\/114\.115\.217\.129)\/gateway\/api\/umetrip\/native(?:\?[^#]*)?$/;
    if (endpoint.test(url)) {
      var headers = request.headers;
      if (headers && typeof headers === "object" && !Array.isArray(headers)) {
        var keys = Object.keys(headers).filter(function (key) {
          return key.toLowerCase() === "rpid";
        });
        // Conflicting duplicate headers or unexpected types are passed through.
        if (keys.length === 1 && typeof headers[keys[0]] === "string") {
          var id = headers[keys[0]].trim();
          if (id === "1000002" || id === "1000019") {
            result = {
              response: {
                status: 404,
                headers: { "Cache-Control": "no-store" },
                body: ""
              }
            };
          }
        }
      }
    }
  } catch (_) {
    result = {};
  }
  $done(result);
})();
