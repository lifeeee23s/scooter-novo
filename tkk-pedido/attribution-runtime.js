(function () {
  'use strict';
  if (window.__tkkAttributionInstalled) return;
  window.__tkkAttributionInstalled = true;
  var fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'src', 'sck', 'ttclid', 'ttp', 'cname', 'adname', 'search', 'advertiser_id', 'campaign_id', 'adgroup_id', 'ad_id'];
  var key = 'tkk_attribution_v1';
  var tracking = {};
  function copy(source) {
    fields.forEach(function (name) {
      var value = source && source[name];
      if (typeof value === 'string' && value.trim()) tracking[name] = value.trim().slice(0, 500);
    });
  }
  try { copy(JSON.parse(window.sessionStorage.getItem(key) || '{}')); } catch (_) {}
  try {
    var params = new URL(window.location.href).searchParams;
    var incoming = {};
    fields.forEach(function (name) { if (params.has(name)) incoming[name] = params.get(name); });
    // A new tagged visit starts a fresh campaign. Do not carry an old click ID
    // or ad identifier into a different campaign when it is absent in this URL.
    if (['utm_source', 'utm_campaign', 'ttclid', 'campaign_id', 'cname', 'adname', 'search'].some(function (name) { return incoming[name] && incoming[name] !== tracking[name]; })) tracking = {};
    copy(incoming);
    if (!tracking.ttp) {
      var cookie = document.cookie.match(/(?:^|;\s*)_ttp=([^;]*)/);
      if (cookie) tracking.ttp = decodeURIComponent(cookie[1]).slice(0, 500);
    }
    window.sessionStorage.setItem(key, JSON.stringify(tracking));
  } catch (_) {}
  if (typeof window.fetch !== 'function') return;
  var previousFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
      var base = String(window.__TKK_BASE_PATH__ || '').replace(/\/+$/, '');
      if (url.origin === window.location.origin && url.pathname === base + '/api/create-pix' && init && typeof init.body === 'string') {
        var payload = JSON.parse(init.body);
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          // Imported checkout pages may read global storage left by another
          // storefront. Only this TKK session is authoritative for attribution.
          fields.forEach(function (name) { delete payload[name]; if (tracking[name]) payload[name] = tracking[name]; });
          init = Object.assign({}, init, {body: JSON.stringify(payload)});
        }
      }
    } catch (_) { /* Attribution must never prevent a payment request. */ }
    return previousFetch(input, init);
  };
})();
