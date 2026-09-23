'use strict';

// A workflow selection is a description of work, never proof of purchase.
function status(search, purchases = []) {
  const paid = purchases.find(p => p.searchId === search.id
    && p.organizationId === search.organizationId && p.activationStatus === 'active');
  if (paid) return { state: 'paid', purchaseId: paid.id, capabilities: paid.offer.capabilities,
    allowanceUsd: paid.offer.allowanceUsd };
  if (search.paymentAccess === 'legacy') return { state: 'legacy', capabilities: ['work', 'ai', 'publish'] };
  return { state: 'unpaid', capabilities: [] };
}

function allows(search, purchases, capability) {
  return status(search, purchases).capabilities.includes(capability);
}

function requireCapability(capability, store) {
  return (req, res, next) => {
    if (allows(req.search, store.projectPurchases, capability)) return next();
    res.status(402).json({ code: 'PROJECT_PAYMENT_REQUIRED',
      error: 'This search needs a completed project payment before this work can start.' });
  };
}

module.exports = { status, allows, requireCapability };
