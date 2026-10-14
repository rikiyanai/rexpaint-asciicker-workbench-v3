// Minimal service worker for the REXPaint Web PWA shell (Tier C)
// Cache-first for static assets, network-first for API requests.
// NOTE: CACHE_NAME must be bumped on each deployment to evict old cached assets.

// DEPLOY: bump this version string on each deployment to evict old cached assets.
// Without a build system, this is the manual cache-bust mechanism.
var CACHE_NAME = 'rexpaint-web-v2-20261014';

var STATIC_ASSET_PATHS = [
  'workbench',
  'styles.css',
  'workbench.js',
  'workbench-template-gating.js',
  'workbench-action-navigation.js',
  'whole-sheet-init.js',
  'persistence.mjs',
  'touch-gestures.mjs',
  'manifest.json',
  'rexpaint-editor/canvas.js',
  'rexpaint-editor/tools/adaptive-stroke-tool.js?v=20261012-slope1',
  'rexpaint-editor/cp437-font.js',
  'rexpaint-editor/editor-app.js',
  'rexpaint-editor/glyph-picker.js',
  'rexpaint-editor/keyboard-handler.js',
  'rexpaint-editor/layer-stack.js',
  'rexpaint-editor/palette.js',
  'rexpaint-editor/styles.css',
  'rexpaint-editor/undo-stack.js',
  'rexpaint-editor/xp-file-reader.js',
  'rexpaint-editor/xp-file-writer.js'
];

// Resolve against the registration scope so the same worker works at both /
// and hosted prefixes such as /xpedit/.
var STATIC_ASSETS = STATIC_ASSET_PATHS.map(function(path) {
  return new URL(path, self.registration.scope).toString();
});

// Install: pre-cache core static assets
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate: clean up old caches and take control of open tabs
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.filter(function(name) {
          return name !== CACHE_NAME;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first for API, cache-first for same-origin static assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Network-first for API requests
  if (url.pathname.indexOf('/api/') !== -1) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Navigations (the workbench document at / or /xpedit prefixes) are
  // network-first: the shell must be fresh without manual unregistering.
  // Cache-first here is what stranded old HTML/CSS/JS behind the old cache.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok && event.request.method === 'GET') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }
  // Version-busted assets (?v= boot nonce) are network-first: the nonce
  // changes every server boot, so the URL itself is the version and a cache
  // hit can never serve a newer boot's bytes. Repeat loads within a boot are
  // still cheap via the HTTP immutable cache. Stale-?v entries accumulate
  // within one CACHE_NAME and are wiped by the per-deploy name bump.
  if (url.searchParams.has('v') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }
  // Cache-first for the remaining same-origin static assets (unversioned
  // extras fetched at runtime; precached cores refresh via CACHE_NAME bumps).
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      return cached || fetch(event.request).then(function(response) {
        // Cache successful GET responses for future offline use
        if (response.ok && event.request.method === 'GET') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
