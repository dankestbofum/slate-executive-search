'use strict';
const crypto = require('crypto');

const VERSION = 'evidence-1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function create({ db, clock = Date.now }) {
  function identity(organizationId, website, jurisdictionType) {
    return JSON.stringify([organizationId, String(website).replace(/\/$/, ''), jurisdictionType, VERSION]);
  }
  function evidence(organizationId, website, jurisdictionType) {
    const key = identity(organizationId, website, jurisdictionType);
    const row = db.db.researchEvidence.find(e => e.key === key && clock() - Date.parse(e.retrievedAt) < TTL_MS);
    return row ? structuredClone(row.site) : null;
  }
  function saveEvidence(organizationId, website, jurisdictionType, site) {
    const key = identity(organizationId, website, jurisdictionType);
    const clean = { canonical:site.canonical, truncated:Boolean(site.truncated),
      pages:(site.pages || []).slice(0,4).map(p => ({ url:p.url, text:String(p.text || '').slice(0,3500),
        documentDate:p.documentDate || null, sourceType:p.sourceType || 'official-site',
        unreadable:Boolean(p.unreadable), hash:hash(String(p.text || '')) })) };
    db.db.researchEvidence = db.db.researchEvidence.filter(e => e.key !== key);
    db.db.researchEvidence.push({ key, organizationId, retrievedAt:new Date(clock()).toISOString(),
      site:clean });
    if (db.db.researchEvidence.length > 200) db.db.researchEvidence.splice(0, db.db.researchEvidence.length-200);
    db.persist();
    return clean;
  }
  function resultKey({ organizationId, city, state, jurisdictionType, position, model, site }) {
    return hash(JSON.stringify([organizationId, city.toLowerCase(), state.toLowerCase(), jurisdictionType,
      position.toLowerCase(), model, VERSION, (site.pages || []).map(p => p.hash || hash(p.text))]));
  }
  function result(key) {
    const row = db.db.researchResults.find(r => r.key === key && clock() - Date.parse(r.at) < TTL_MS);
    return row ? structuredClone(row.result) : null;
  }
  function saveResult(key, result) {
    db.db.researchResults = db.db.researchResults.filter(r => r.key !== key);
    db.db.researchResults.push({ key, at:new Date(clock()).toISOString(), result:structuredClone(result) });
    if (db.db.researchResults.length > 200) db.db.researchResults.splice(0, db.db.researchResults.length-200);
    db.persist();
  }
  return { evidence, saveEvidence, resultKey, result, saveResult };
}
module.exports = { VERSION, TTL_MS, create };
