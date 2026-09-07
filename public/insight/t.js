/* Insight, self hosted. Reports to this instance and nowhere else. */
(function () {
  var s = document.currentScript;
  var site = (s && s.getAttribute('data-site')) || 'linkedgrow';
  /* Same origin on purpose: no third-party host, so an ad blocker treats this
     as first-party and the data cannot go anywhere but here. */
  var ENDPOINT = '/api/insight/collect';
  /* No cookie and no localStorage. The upstream tracker offered a persistent
     visitor id behind data-persist; this instance has one user, so a stable id
     buys nothing and would need a consent banner in the EU. */
  function payload(type, extra) {
    var u = new URL(location.href);
    var body = {
      site: site,
      type: type,
      /* path only. This app's URLs carry agent and lead identifiers, and the
         collector drops anything else anyway, so it is never sent either. */
      path: location.pathname,
      referrer: document.referrer || '',
      lang: navigator.language || '',
      sw: window.screen ? window.screen.width : 0,
      utm_source: u.searchParams.get('utm_source') || '',
      utm_medium: u.searchParams.get('utm_medium') || '',
      utm_campaign: u.searchParams.get('utm_campaign') || ''
    };
    if (extra) for (var k in extra) body[k] = extra[k];
    return JSON.stringify(body);
  }
  function send(type, extra) {
    try {
      var data = payload(type, extra);
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'text/plain' }));
      else fetch(ENDPOINT, { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) { /* analytics never breaks the page */ }
  }
  send('pageview');
  /* The App Router changes the URL without a reload, so a page view has to be
     noticed rather than waited for. */
  var last = location.pathname;
  function check() { if (location.pathname !== last) { last = location.pathname; send('pageview'); } }
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); check(); };
  addEventListener('popstate', check);
  /* One duration on the way out, so a long session is one row rather than many. */
  var start = Date.now();
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      send('custom', { duration_ms: Date.now() - start });
      start = Date.now();
    }
  });
  window.insight = { goal: function (name) { send('goal', { goal: String(name).slice(0, 64) }); } };
})();
