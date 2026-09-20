'use strict';

// Where local configuration comes from, in one place.
//
// The application and the operator preflight have to agree about this. They did
// not: the server loaded a local `.env` in development, and the preflight read
// bare `process.env`, so `npm run preflight` reported no API key on a machine
// where `npm run dev` had one. A diagnostic that disagrees with the thing it is
// diagnosing is worse than no diagnostic, because it sends the operator looking
// in the wrong place.
//
// The rule it encodes is unchanged: a local `.env` is a development
// convenience. In production the platform's environment is authoritative, so a
// stray `.env` baked into an image must never silently replace deployed
// configuration, and tests always supply their own environment.

const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

/** Is a local `.env` allowed to contribute here at all? */
function localEnvAllowed(env = process.env){
  return env.NODE_ENV !== 'test' && env.NODE_ENV !== 'production';
}

/**
 * Load the local `.env` if this environment is one that may have one.
 *
 * Returns what happened so a diagnostic can say which configuration it is
 * reporting on, rather than leaving the reader to guess.
 */
function loadLocalEnv(env = process.env){
  if (!localEnvAllowed(env)) {
    return { loaded: false, reason: env.NODE_ENV === 'production' ? 'production' : 'test', path: ENV_PATH };
  }
  try {
    const out = require('dotenv').config({ path: ENV_PATH, override: true });
    if (out.error) return { loaded: false, reason: 'unreadable', path: ENV_PATH, error: out.error.message };
    return { loaded: true, reason: 'development', path: ENV_PATH, keys: Object.keys(out.parsed || {}).length };
  } catch (error) {
    // dotenv is a dependency, not a guarantee: an image that omitted it should
    // still start on the platform environment rather than crash.
    return { loaded: false, reason: 'unavailable', path: ENV_PATH, error: error.message };
  }
}

/* ------------------------------------------------------------------ *
 * Release identity
 *
 * Which commit is this? Two sources answer, and either can be wrong, which is
 * the point: a deployed service was observed reporting a commit that did not
 * contain the code it was running.
 *
 *  - SLATE_RELEASE is stamped into the image at build time by CI
 *    (--build-arg SLATE_RELEASE=$GITHUB_SHA). It describes the code.
 *  - RENDER_GIT_COMMIT is supplied by the host at runtime. It describes the
 *    deploy.
 *
 * The Dockerfile defaults the build argument to "unknown" so the image builds
 * without CI, and Render's own blueprint builds pass no build argument at all.
 * A placeholder is therefore the normal case on that path, and it is not a
 * stamp: reading it as one would report "unknown" as the running commit and
 * ignore the host's answer entirely.
 * ------------------------------------------------------------------ */

// Values that mean "nobody said". Compared case-insensitively.
const PLACEHOLDER_RELEASE = new Set(['unknown', 'dev', 'none', 'local', 'null', 'undefined', 'latest']);

function stampOf(value){
  const trimmed = String(value || '').trim();
  return PLACEHOLDER_RELEASE.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/**
 * The release this process should report, and where it came from.
 *
 * A hand-set SLATE_RELEASE deployment variable is indistinguishable from a
 * build stamp from in here, and that is exactly what goes stale, so when both
 * sources answer and disagree the disagreement is reported rather than
 * resolved. Whichever is wrong, a comparison against a local commit is not
 * meaningful until somebody looks.
 */
function release(env = process.env){
  const build = stampOf(env.SLATE_RELEASE);
  const platform = stampOf(env.RENDER_GIT_COMMIT);
  return {
    id: build || platform || 'dev',
    source: build ? 'build' : (platform ? 'platform' : 'unstamped'),
    build: build || null,
    platform: platform || null,
    stamped: Boolean(build || platform),
    agrees: !(build && platform) || build === platform
  };
}

module.exports = { loadLocalEnv, localEnvAllowed, ENV_PATH, release, PLACEHOLDER_RELEASE };
