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

// Per-page HTTP budget. The crawl deadline carried on the operation is the real
// bound; this stops a single unresponsive page from consuming all of it.
const PAGE_TIMEOUT_MS = 12000;
// DNS is the one wait that is not inside the fetch, and an OS resolver lookup
// is not cancellable. It gets its own deadline, and a result that arrives after
// that deadline is discarded rather than used to open a socket.
const DNS_TIMEOUT_MS = 5000;
const MAX_BYTES = 1500000;

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

function dnsTimeoutError(host){
  const err = new Error('Looking up ' + host + ' took too long.');
  err.code = 'DNS_TIMEOUT';
  return err;
}

/**
 * Does this error mean the whole operation is over?
 *
 * The crawler catches broadly on purpose: one unreachable page is not a reason
 * to abandon research. Cancellation and the shared deadline are the exceptions,
 * and they must travel out through those catches rather than being swallowed
 * into "that page did not load".
 */
function operationEnded(err){
  return Boolean(err) && (err.code === 'RESEARCH_CANCELLED' || err.code === 'RESEARCH_TIMEOUT');
}

function publicUrl(raw){
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    const err = new Error('Enter the official jurisdiction website.');
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

/**
 * Resolve a hostname under a deadline, and under the operation's abort signal.
 *
 * `dns.lookup` delegates to the OS resolver, which cannot be cancelled. This
 * does not pretend otherwise: the lookup keeps running in the background, and
 * what this guarantees is that its answer is thrown away once the caller has
 * given up. That is the part that matters, because the alternative is a socket
 * opening to an address nobody is waiting for any more.
 */
function resolvePublic(hostname, { timeoutMs = DNS_TIMEOUT_MS, signal = null } = {}){
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const onAbort = () => finish(signal.reason || blockedUrlError());

    function finish(error, addresses){
      if (settled) return true;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(addresses);
      return false;
    }

    if (signal) {
      if (signal.aborted) { finish(signal.reason || blockedUrlError()); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => finish(dnsTimeoutError(hostname)), Math.max(1, timeoutMs));
    if (timer.unref) timer.unref();

    dns.lookup(hostname, { all: true }).then(
      addresses => { finish(null, addresses); },
      error => { finish(error); }
    );
  });
}

async function assertPublicHost(u, opts = {}){
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw blockedUrlError();
    }
    return;
  }
  const found = await resolvePublic(host, opts);
  if (!found.length || found.some(row => isPrivateIp(row.address))) {
    throw blockedUrlError();
  }
}

// Resolves and validates the host, then opens the socket to that exact
// validated address — closing the gap where a hostname could resolve to a
// public IP for assertPublicHost and a private/internal IP moments later
// for fetch's own DNS lookup (DNS rebinding).
//
// The lookup carries its own deadline. Without one, a resolver that answers
// after the operation has been abandoned would still reach connectTo and open
// a socket on behalf of work nobody is waiting for.
function safeConnect(opts, callback){
  const hostname = opts.hostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      callback(blockedUrlError());
      return;
    }
    return connectTo(hostname, opts, callback);
  }
  resolvePublic(hostname, { timeoutMs: DNS_TIMEOUT_MS }).then(addrs => {
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

// Pages worth reading on any local-government site.
const SHARED_LINKS = 'budget|finance|about|government|community|department|census';

// A county site does not have a city manager or a council, and the pages that
// carry its authority structure are named differently. Looking only for
// municipal words on a county site finds the generic pages and misses the ones
// that say who the administrator reports to and which offices are separately
// elected.
const COUNTY_LINKS = 'county-administrator|countyadministrator|county-manager|countymanager'
  + '|board-of-supervisors|boardofsupervisors|supervisor|elected-official|electedofficials'
  + '|organizational-chart|org-chart|strategic-plan|adopted-budget|county-government|our-county';

const MUNICIPAL_LINKS = 'city-manager|citymanager|town-manager|council|our-city|city-government';

function linkPattern(jurisdictionType){
  // Both sets are always allowed. A county site that still uses "council"
  // somewhere should not have that page skipped, and the municipal regression
  // fixture must keep behaving exactly as before.
  const order = jurisdictionType === 'county'
    ? [COUNTY_LINKS, SHARED_LINKS, MUNICIPAL_LINKS]
    : [MUNICIPAL_LINKS, SHARED_LINKS, COUNTY_LINKS];
  return new RegExp(order.join('|'));
}

function extractLinks(html, base, jurisdictionType){
  const out = [];
  const seen = new Set();
  const wanted = linkPattern(jurisdictionType);
  const preferred = jurisdictionType === 'county' ? new RegExp(COUNTY_LINKS) : new RegExp(MUNICIPAL_LINKS);
  const ranked = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(String(html||'')))) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    const hay = (u.pathname + ' ' + decodeURIComponent(u.pathname)).toLowerCase();
    if (!wanted.test(hay)) continue;
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    // Pages matching this jurisdiction's own vocabulary come first, so the
    // fetch budget is spent on them rather than on generic pages that happen
    // to appear earlier in the markup.
    ranked.push({ url: u.toString(), score: preferred.test(hay) ? 0 : 1 });
  }
  ranked.sort((a, b) => a.score - b.score);
  for (const item of ranked) {
    out.push(item.url);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Read a response body without trusting its length.
 *
 * Content-Length is a claim, so the cap is applied while the bytes arrive
 * rather than after. Going over stops reading and releases the socket instead
 * of buffering megabytes that will be discarded anyway.
 */
async function readBounded(body, limit){
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks);
}

async function discard(res){
  if (res && res.body && !res.bodyUsed) {
    await res.body.cancel().catch(() => {});
  }
}

/**
 * The signal one HTTP attempt runs under.
 *
 * Three bounds at once: the operation's own abort signal, the crawl deadline,
 * and this page's share of it. A redirect chain reuses the same deadline rather
 * than resetting the clock at every hop, which is how a chain of slow 302s used
 * to outlast the timeout that was supposed to contain it.
 */
function attemptSignal(deadlineAt, signal){
  const left = Math.max(1, deadlineAt - Date.now());
  const perPage = AbortSignal.timeout(Math.min(PAGE_TIMEOUT_MS, left));
  return signal ? AbortSignal.any([signal, perPage]) : perPage;
}

async function fetchOnce(url, hops, jurisdictionType, ctx){
  if (hops > 5) return null;
  if (Date.now() >= ctx.deadlineAt) return null;
  if (ctx.signal && ctx.signal.aborted) throw ctx.signal.reason || blockedUrlError();

  const dnsBudget = Math.min(DNS_TIMEOUT_MS, Math.max(1, ctx.deadlineAt - Date.now()));
  await assertPublicHost(url, { timeoutMs: dnsBudget, signal: ctx.signal });

  let res;
  try {
    res = await fetch(url.toString(), {
      signal: attemptSignal(ctx.deadlineAt, ctx.signal),
      redirect: 'manual',
      dispatcher: safeAgent,
      headers: {
        'user-agent': 'SlateSearch/1.0 (executive-search research)',
        'accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1'
      }
    });
  } catch (error) {
    if (operationEnded(error)) throw error;
    return null;
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    await discard(res);
    if (!loc) return null;
    let next;
    // A redirect target is validated as a fresh URL, so a public page cannot
    // redirect the crawler onto a private address or another scheme.
    try { next = publicUrl(new URL(loc, url).toString()); } catch { return null; }
    return fetchOnce(next, hops + 1, jurisdictionType, ctx);
  }
  if (!res.ok) { await discard(res); return null; }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('text') && !ct.includes('xml')) {
    await discard(res);
    return null;
  }

  let buf;
  try {
    buf = await readBounded(res.body, MAX_BYTES);
  } catch (error) {
    if (operationEnded(error)) throw error;
    return null;
  }
  if (!buf) return null;
  const html = buf.toString('utf8');
  const text = htmlToText(html).slice(0, 9000);
  if (!text) return null;
  return { url: url.toString(), text, links: extractLinks(html, url, jurisdictionType) };
}

async function fetchPage(raw, jurisdictionType, ctx){
  try {
    return await fetchOnce(publicUrl(raw), 0, jurisdictionType, ctx);
  } catch (error) {
    // One page that cannot be read is ordinary. The operation ending is not,
    // and must not be mistaken for it.
    if (operationEnded(error)) throw error;
    return null;
  }
}

// Boilerplate paths to try when a home page links to nothing useful. The
// county list names the pages that actually carry a county's authority
// structure: who the administrator reports to, which offices are separately
// elected, and what the board adopted.
const SHARED_PATHS = ['/government', '/departments', '/about', '/finance', '/budget'];

const MUNICIPAL_PATHS = ['/city-government', '/city-manager', '/our-community'];

const COUNTY_PATHS = [
  '/county-administrator',
  '/county-manager',
  '/board-of-supervisors',
  '/supervisors',
  '/elected-officials',
  '/organizational-chart',
  '/strategic-plan',
  '/adopted-budget',
  '/county-government'
];

function extraPaths(jurisdictionType){
  return jurisdictionType === 'county'
    ? [...COUNTY_PATHS, ...SHARED_PATHS]
    : [...MUNICIPAL_PATHS, ...SHARED_PATHS];
}

const PAGE_LIMIT = 6;
const FETCH_CONCURRENCY = 4;
// Successes used to be the only thing counted, so a site where most pages 404
// could keep opening fresh batches. Attempts are bounded too.
const ATTEMPT_LIMIT = 16;

/**
 * Read a jurisdiction's website inside a bounded budget.
 *
 * `op` is the research operation (server/research-op.js). Its crawl budget is a
 * deadline for this whole function, not per page, and its abort signal reaches
 * the DNS waits, the sockets, and the response bodies. When the budget runs out
 * the pages already read are returned: partial source material is worth more
 * than none, and the model is told what it did and did not get.
 */
async function fetchCitySite(raw, jurisdictionType = 'municipality', op = null){
  const home = publicUrl(raw);
  const ctx = {
    deadlineAt: Date.now() + (op ? op.crawlBudget() : PAGE_TIMEOUT_MS * 3),
    signal: op ? op.signal : null
  };
  const dnsBudget = Math.min(DNS_TIMEOUT_MS, Math.max(1, ctx.deadlineAt - Date.now()));
  await assertPublicHost(home, { timeoutMs: dnsBudget, signal: ctx.signal });

  const pages = [];
  const seen = new Set();
  let attempts = 0;
  let truncated = false;
  const markSeen = (u) => {
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const budgetGone = () => {
    if (Date.now() >= ctx.deadlineAt || attempts >= ATTEMPT_LIMIT) { truncated = true; return true; }
    return false;
  };

  const homeUrl = home.toString();
  markSeen(home);
  attempts += 1;
  const homePage = await fetchPage(homeUrl, jurisdictionType, ctx);
  if (homePage) pages.push(homePage);

  const discovered = (homePage && homePage.links) || [];
  const candidates = [];
  for (const href of [...discovered, ...extraPaths(jurisdictionType).map(p => new URL(p, home).toString())]) {
    let u;
    try { u = publicUrl(href); } catch { continue; }
    if (markSeen(u)) candidates.push(u.toString());
  }

  // Discovered links and boilerplate government/finance paths are independent
  // fetches (each has its own DNS + TLS + HTTP round trip), so a bounded batch
  // runs concurrently rather than one at a time. The page cap, the attempt cap
  // and the crawl deadline all end it; whichever comes first, what has been
  // read is kept.
  let reached = 0;
  for (let i = 0; i < candidates.length && pages.length < PAGE_LIMIT; i += FETCH_CONCURRENCY) {
    if (budgetGone()) break;
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
    attempts += batch.length;
    reached = i + batch.length;
    const results = await Promise.all(batch.map(url => fetchPage(url, jurisdictionType, ctx)));
    for (const page of results) {
      if (page && pages.length < PAGE_LIMIT) pages.push(page);
    }
  }
  // Truncated means candidates were left unread because a bound was hit, which
  // is what the prompt needs to know: "this is what we got" rather than "this
  // is what the site has".
  return { canonical: homeUrl, pages, attempts, truncated: truncated && reached < candidates.length };
}

module.exports = {
  publicUrl, fetchCitySite, extractLinks, extraPaths, htmlToText,
  assertPublicHost, resolvePublic, operationEnded,
  PAGE_LIMIT, ATTEMPT_LIMIT, PAGE_TIMEOUT_MS, DNS_TIMEOUT_MS, MAX_BYTES
};
