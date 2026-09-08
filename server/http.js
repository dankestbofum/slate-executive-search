'use strict';

// The browser-facing boundary: response headers, same-origin enforcement,
// request rate limits, path redaction for logs, and structured errors.
// Kept separate from index.js so each control can be read and tested on its
// own rather than being buried among route handlers.

const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

/* ------------------------------------------------------------------ *
 * Content-Security-Policy
 *
 * The front end makes this affordable: no inline scripts, no inline style
 * attributes, no eval, and fonts are served from this origin. So every
 * source stays 'self' with no unsafe- keyword and no third-party host.
 *
 * img-src carries data: and blob: because photo upload previews the chosen
 * file through URL.createObjectURL before encoding it.
 * ------------------------------------------------------------------ */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "worker-src 'self'"
];

const CSP = CSP_DIRECTIVES.join('; ');

// Bearer-link pages are opened by members of the public. A referrer would
// leak the candidate's token to any site they navigate to next.
const BEARER_PATH = /^\/(api\/)?apply(\/|$)/;

function securityHeaders(req, res, next) {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  // frame-ancestors covers modern browsers; this is the legacy companion.
  res.set('X-Frame-Options', 'DENY');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('Referrer-Policy', BEARER_PATH.test(req.path) ? 'no-referrer' : 'strict-origin-when-cross-origin');
  // Only meaningful over HTTPS, and only safe once the deployment terminates
  // TLS for every hostname it answers on.
  if (isProd) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

/* ------------------------------------------------------------------ *
 * Same-origin enforcement (CSRF)
 *
 * Session authentication is a cookie, so a state-changing request has to
 * prove it came from this application rather than from a page the user
 * happened to be visiting.
 *
 * Absent Origin and Sec-Fetch-Site means a non-browser client: the CLI, the
 * test suite, a monitor. Those cannot be driven by a hostile page, which is
 * the threat this control exists for, so they are allowed through. That is a
 * deliberate trade documented in README; it is not a gap a browser can walk
 * into, because browsers always send Origin on a cross-origin mutation.
 * ------------------------------------------------------------------ */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const site = req.get('Sec-Fetch-Site');
  if (site) {
    // 'none' is a direct user action such as a typed URL or a bookmark.
    if (site === 'same-origin' || site === 'none') return next();
    return refuse(res, 'This request did not come from Slate.');
  }

  const origin = req.get('Origin');
  if (!origin) return next();

  let hostname;
  try { hostname = new URL(origin).hostname; }
  catch { return refuse(res, 'This request did not come from Slate.'); }

  if (hostname !== req.hostname) return refuse(res, 'This request did not come from Slate.');
  return next();
}

function refuse(res, message) {
  return res.status(403).json({ error: message });
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * A fixed window per key, held in memory. One process owns the JSON store
 * (see DEP-04), so a shared counter store would add a dependency without
 * changing the outcome. Limits are deliberately loose enough not to
 * interfere with ordinary work and tight enough to bound abuse.
 * ------------------------------------------------------------------ */
function limiter({ windowMs, max, key, message }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, row] of hits) if (now - row.start > windowMs * 2) hits.delete(id);
  }, windowMs).unref();

  const middleware = (req, res, next) => {
    const id = key(req);
    if (!id) return next();
    const now = Date.now();
    const row = hits.get(id);
    if (!row || now - row.start > windowMs) {
      hits.set(id, { start: now, n: 1 });
      return next();
    }
    row.n += 1;
    if (row.n > max) {
      const retry = Math.ceil((row.start + windowMs - now) / 1000);
      res.set('Retry-After', String(Math.max(retry, 1)));
      return res.status(429).json({ error: message });
    }
    next();
  };

  middleware.reset = () => hits.clear();
  middleware.stop = () => clearInterval(sweep);
  return middleware;
}

/* ------------------------------------------------------------------ *
 * Log safety
 *
 * Candidate questionnaire links carry a bearer token in the path. Anything
 * written to a log, a metric label or an error report goes through this
 * first, so the token never lands somewhere with weaker access rules than
 * the record it unlocks.
 * ------------------------------------------------------------------ */
function safePath(value) {
  const path = String(value || '').split('?')[0];
  return path
    .replace(/^(\/(?:api\/)?apply)\/[^/]+/, '$1/:token')
    .replace(/^(\/media)\/[^/]+/, '$1/:id');
}

const SECRET_KEYS = /^(pin|password|secret|token|invite|apiKey|authorization|cookie)$/i;

// Shallow by design: it is used on small diagnostic objects, never on record
// bodies, and must not become a reason to put candidate answers in a log.
function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '[redacted]' : (typeof item === 'object' && item ? '[object]' : item);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Correlation IDs and structured errors
 * ------------------------------------------------------------------ */
function correlate(req, res, next) {
  req.ref = crypto.randomBytes(8).toString('hex');
  res.set('X-Request-Id', req.ref);
  next();
}

// Terminal error handler. Production replies carry a reference and nothing
// else; the detail stays in the process log where access is controlled.
function errors(logger = console) {
  // eslint-disable-next-line no-unused-vars -- Express identifies this by arity.
  return (err, req, res, _next) => {
    const ref = req.ref || 'no-ref';

    if (err?.type === 'entity.too.large') {
      logger.warn?.('[' + ref + '] payload too large ' + req.method + ' ' + safePath(req.originalUrl));
      return res.status(413).json({ error: 'That request was too large.', ref });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      logger.warn?.('[' + ref + '] malformed JSON ' + req.method + ' ' + safePath(req.originalUrl));
      return res.status(400).json({ error: 'That request was not valid JSON.', ref });
    }

    logger.error('[' + ref + '] ' + req.method + ' ' + safePath(req.originalUrl) + ' failed: ' + (err?.message || 'unknown error'));
    if (!isProd && err?.stack) logger.error(err.stack);

    if (res.headersSent) return;
    res.status(500).json({
      error: 'Something went wrong. Quote this reference if you contact support.',
      ref
    });
  };
}

module.exports = {
  CSP, CSP_DIRECTIVES, securityHeaders, sameOrigin, limiter,
  safePath, redact, correlate, errors
};
