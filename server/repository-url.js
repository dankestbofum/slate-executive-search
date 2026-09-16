'use strict';

// Inventory links must identify a document behind repository authentication.
// Query strings, fragments, userinfo and common anonymous sharing paths are
// refused rather than rewritten: stripping a signature can change the target.
// An opaque path can still grant access; the repository's permissions must be
// reviewed by its owner. This check does not certify those permissions.
function repositoryUrlError(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { return 'That is not a valid link.'; }
  if (url.protocol !== 'https:') return 'Use an https link to the approved document repository.';
  if (String(value).length > 2000) return 'That link is too long.';
  if (url.username || url.password || url.search || url.hash ||
      /(^|\.)1drv\.ms$/i.test(url.hostname) ||
      /\/(?:s|scl|share|sharing)\//i.test(url.pathname) ||
      /\/:[a-z]:\/[gs]\//i.test(url.pathname)) {
    return 'Use the permanent document URL requiring repository sign-in, without sharing credentials, query parameters or fragments. Record its identifier in the label if no such URL is available.';
  }
  return null;
}

function exportLocation(value) {
  if (!value) return null;
  return repositoryUrlError(value) ? '[withheld: retrieve by document identifier from the approved repository]' : value;
}

module.exports = { repositoryUrlError, exportLocation };
