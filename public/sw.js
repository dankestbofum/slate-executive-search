'use strict';

// Caches the app shell only, so the installed PWA opens instantly (and
// offline). Everything dynamic or auth-sensitive (/api, /media, /apply) is
// intentionally never touched here — it always goes straight to the network.

const CACHE_NAME = 'slate-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/app.js',
  '/app.css',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function bypassed(url) {
  return url.origin !== self.location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/media/')
    || url.pathname.startsWith('/apply/');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (bypassed(url)) return;

  // Network-first, cache fallback: always prefer the latest code when
  // online (so local edits show up on the very next reload), and only
  // serve the cached shell when the network is unreachable.
  const cacheKey = event.request.mode === 'navigate' ? '/' : event.request;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
        return res;
      })
      .catch(() => caches.match(cacheKey))
  );
});
