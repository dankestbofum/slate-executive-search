'use strict';

const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const { URL } = require('url');
const { Agent } = require('undici');

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost',
  'metadata.google.internal', 'metadata.internal'
]);

function isPrivateIp(ip){
  if (!ip) return true;
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const n = ip.toLowerCase();
    if (n === '::1' || n === '::') return true;
    if (n.startsWith('fe80:') || n.startsWith('fc') || n.startsWith('fd')) return true;
    if (n.startsWith('::ffff:')) return isPrivateIp(n.slice(7));
    return false;
  }
  return true;
}

function blockedUrlError(){
  const err = new Error('That website cannot be used.');
  err.code = 'BAD_URL';
  return err;
}

function publicUrl(raw){
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    const err = new Error('Enter the official city website.');
    err.code = 'BAD_URL';
    throw err;
  }
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : 'https://' + trimmed);
  } catch {
    const err = new Error('That website is not a valid address.');
    err.code = 'BAD_URL';
    throw err;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const err = new Error('Use an http or https address.');
    err.code = 'BAD_URL';
    throw err;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || host.endsWith('.arpa')) {
    throw blockedUrlError();
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw blockedUrlError();
  }
  return u;
}

async function assertPublicHost(u){
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw blockedUrlError();
    }
    return;
  }
  const found = await dns.lookup(host, { all: true });
  if (!found.length || found.some(row => isPrivateIp(row.address))) {
    throw blockedUrlError();
  }
}

// Resolves and validates the host, then opens the socket to that exact
// validated address — closing the gap where a hostname could resolve to a
// public IP for assertPublicHost and a private/internal IP moments later
// for fetch's own DNS lookup (DNS rebinding).
function safeConnect(opts, callback){
  const hostname = opts.hostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      callback(blockedUrlError());
      return;
    }
    return connectTo(hostname, opts, callback);
  }
  dns.lookup(hostname, { all: true }).then(addrs => {
    if (!addrs.length || addrs.some(row => isPrivateIp(row.address))) {
      callback(blockedUrlError());
      return;
    }
    connectTo(addrs[0].address, opts, callback);
  }, callback);
}

function connectTo(address, opts, callback){
  if (opts.protocol === 'https:') {
    const socket = tls.connect({
      host: address,
      port: opts.port || 443,
      servername: opts.servername || opts.hostname
    });
    socket.once('secureConnect', () => callback(null, socket));
    socket.once('error', callback);
  } else {
    const socket = net.connect({ host: address, port: opts.port || 80 });
    socket.once('connect', () => callback(null, socket));
    socket.once('error', callback);
  }
}

const safeAgent = new Agent({ connect: safeConnect });

function htmlToText(html){
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractLinks(html, base){
  const out = [];
  const seen = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(String(html||'')))) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    const hay = (u.pathname + ' ' + decodeURIComponent(u.pathname)).toLowerCase();
    if (!/budget|finance|about|government|city-manager|citymanager|council|community|department|census|our-city/.test(hay)) continue;
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.toString());
    if (out.length >= 8) break;
  }
  return out;
}

async function fetchOnce(url, hops){
  if (hops > 5) return null;
  await assertPublicHost(url);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(12000),
    redirect: 'manual',
    dispatcher: safeAgent,
    headers: {
      'user-agent': 'SlateSearch/1.0 (executive-search research)',
      'accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1'
    }
  });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc) return null;
    return fetchOnce(new URL(loc, url), hops + 1);
  }
  if (!res.ok) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('text') && !ct.includes('xml')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 1_500_000) return null;
  const html = buf.toString('utf8');
  const text = htmlToText(html).slice(0, 9000);
  if (!text) return null;
  return { url: url.toString(), text, links: extractLinks(html, url) };
}

async function fetchPage(raw){
  try {
    return await fetchOnce(publicUrl(raw), 0);
  } catch {
    return null;
  }
}

const EXTRA_PATHS = [
  '/government',
  '/city-government',
  '/city-manager',
  '/departments',
  '/about',
  '/our-community',
  '/finance',
  '/budget'
];

const PAGE_LIMIT = 6;
const FETCH_CONCURRENCY = 4;

async function fetchCitySite(raw){
  const home = publicUrl(raw);
  await assertPublicHost(home);
  const pages = [];
  const seen = new Set();
  const markSeen = (u) => {
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const homeUrl = home.toString();
  markSeen(home);
  const homePage = await fetchPage(homeUrl);
  if (homePage) pages.push(homePage);

  const discovered = (homePage && homePage.links) || [];
  const candidates = [];
  for (const href of [...discovered, ...EXTRA_PATHS.map(p => new URL(p, home).toString())]) {
    let u;
    try { u = publicUrl(href); } catch { continue; }
    if (markSeen(u)) candidates.push(u.toString());
  }

  // Discovered links and boilerplate government/finance paths are independent
  // fetches (each has its own DNS + TLS + HTTP round trip, up to a 12s
  // timeout) — running a bounded batch concurrently instead of one at a time
  // cuts the "Research this city" wall-clock time roughly in proportion to
  // page count, while still honoring the page cap and priority order.
  for (let i = 0; i < candidates.length && pages.length < PAGE_LIMIT; i += FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchPage));
    for (const page of results) {
      if (page && pages.length < PAGE_LIMIT) pages.push(page);
    }
  }
  return { canonical: homeUrl, pages };
}

module.exports = { publicUrl, fetchCitySite };
