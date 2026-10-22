// DeepARAM offline support: the pages you open most recently are kept so they still open without a
// connection; anything not kept falls back to /offline, which lists the kept pages.
const PAGES = "deeparam-pages-v1";
const STATIC = "deeparam-static-v1";
const KEEP_PAGES = 30;
const KEEP_STATIC = 400;
const OFFLINE = "/offline";
// Never kept: account pages, admin, live checks and anything personal.
const SKIP = /^\/(api|admin|stats)(\/|$)|^\/data\/version\.json$/;

self.addEventListener("install", (e) => {
  // The offline page and every build file it needs, so it works even if it was never opened.
  e.waitUntil(
    (async () => {
      const res = await fetch(OFFLINE);
      const html = await res.clone().text();
      await (await caches.open(PAGES)).put(OFFLINE, res);
      const files = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
      const stat = await caches.open(STATIC);
      await Promise.all(files.map((f) => stat.add(f).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("deeparam-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Keep the newest entries: re-adding moves a page to the end, and the oldest are dropped.
async function keep(name, req, res, max) {
  const cache = await caches.open(name);
  await cache.delete(req);
  await cache.put(req, res);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) if (new URL(k.url).pathname !== OFFLINE) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || SKIP.test(url.pathname)) return;
  // App-router data for in-app navigation varies per request; offline it falls back to a full page load.
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const key = url.origin + url.pathname + url.search;
            e.waitUntil(keep(PAGES, key, res.clone(), KEEP_PAGES));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.origin + url.pathname + url.search, { cacheName: PAGES })) || (await caches.match(url.origin + url.pathname, { cacheName: PAGES, ignoreSearch: true })) || caches.match(OFFLINE)),
    );
    return;
  }

  // Build files never change under the same name and come from the cache. Pictures and fonts come from the
  // cache and are refreshed in the background. Scripts, styles and data (an embed's data.js, the day's Chef
  // Special) change under the same name, so they come from the network and the cache only serves offline.
  // Video and sound (range requests) and big files like 3D models are left to the browser.
  if (req.headers.has("range")) return;
  const immutable = url.pathname.startsWith("/_next/static/");
  const small = /^\/(icons|data)\//.test(url.pathname) || (/^\/(assets|embed)\//.test(url.pathname) && /\.(js|css|json|html|webp|png|jpe?g|svg|woff2)$/i.test(url.pathname));
  if (!immutable && !small) return;
  const fresh = !immutable && /\.(js|css|json|html)$/i.test(url.pathname);
  e.respondWith(
    caches.match(req, { cacheName: STATIC }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.status === 200 && res.type === "basic" && Number(res.headers.get("content-length") || 0) < 3e6) e.waitUntil(keep(STATIC, req, res.clone(), KEEP_STATIC));
          return res;
        })
        .catch(() => hit || Response.error());
      if (fresh) return net;
      return immutable && hit ? hit : hit ? (e.waitUntil(net), hit) : net;
    }),
  );
});
