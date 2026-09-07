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
module.exports = { hash, verify, set };
