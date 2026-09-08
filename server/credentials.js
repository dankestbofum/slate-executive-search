'use strict';
const crypto = require('crypto');

function hash(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(secret), salt, 32).toString('hex');
}
function verify(user, secret) {
  if (!user?.pinHash || typeof secret !== 'string' || secret.length > 256) return false;
  const [salt, hex] = user.pinHash.split(':');
  if (!salt || !/^[a-f0-9]{64}$/.test(hex || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), crypto.scryptSync(secret, salt, 32));
}
function set(user, secret) { user.pinHash = hash(secret); delete user.pin; }

// The PINs that ship for local development. They are published in README and
// .env.example, so they are public knowledge and must never authenticate a
// production account.
const DEV_DEFAULTS = new Set(['1234', '2468', '1357']);

const MIN_LENGTH = 8;

/**
 * Whether a proposed credential is strong enough for production use.
 *
 * Returns null when acceptable, otherwise the reason. Hashing does not make a
 * weak secret strong: an eight-digit PIN has 10^8 possibilities, which is only
 * meaningful because online guessing is rate limited. These rules exist to
 * remove the cases that defeat the rate limit entirely, namely a value an
 * attacker would try in their first handful of guesses.
 */
function weakness(secret) {
  const value = String(secret ?? '');
  if (!value) return 'A PIN is required.';
  if (DEV_DEFAULTS.has(value)) return 'That is a published development PIN. Choose another.';
  if (value.length < MIN_LENGTH) return 'Use at least ' + MIN_LENGTH + ' characters.';
  if (/^(.)\1*$/.test(value)) return 'Do not repeat a single character.';
  if (isRun(value)) return 'Do not use a simple ascending or descending run.';
  return null;
}

function isRun(value) {
  if (!/^\d+$/.test(value)) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < value.length; i += 1) {
    const step = Number(value[i]) - Number(value[i - 1]);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
  }
  return up || down;
}

module.exports = { hash, verify, set, weakness, DEV_DEFAULTS, MIN_LENGTH };
