'use strict';

// Clerk owns checkout, payment details and subscription state. Slate exposes
// only a public plan catalog and an administrator's active-workspace summary.
function configuration(env) {
  const mode = env.SLATE_BILLING_MODE || 'off';
  const valid = mode === 'off' || (['test', 'live'].includes(mode)
    && String(env.CLERK_SECRET_KEY || '').startsWith(mode === 'test' ? 'sk_test_' : 'sk_live_')
    && String(env.CLERK_PUBLISHABLE_KEY || '').startsWith(mode === 'test' ? 'pk_test_' : 'pk_live_'));
  return { mode: valid ? mode : 'off', enabled: valid && mode !== 'off', invalid: !valid };
}

function money(value) {
  if (!value || !Number.isFinite(value.amount) || !value.currency) return null;
  return { amount: value.amount, amountFormatted: value.amountFormatted, currency: value.currency };
}

function plan(value) {
  return {
    id: value.id, name: value.name, description: value.description || '',
    isDefault: Boolean(value.isDefault), fee: money(value.fee), annualMonthlyFee: money(value.annualMonthlyFee),
    annualFee: money(value.annualFee), freeTrialDays: value.freeTrialEnabled ? value.freeTrialDays : 0,
    features: (value.features || []).map(f => ({ name: f.name, description: f.description || '' }))
  };
}

function unavailable(error) {
  if (error?.errors?.some(e => e.code === 'billing_not_enabled')) return { status: 'not-enabled' };
  // Provider outages must not appear to be a free or cancelled subscription.
  const failure = new Error('Billing is temporarily unavailable. Please try again.');
  failure.status = 503;
  throw failure;
}

async function bounded(work) {
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Billing timeout')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

function create({ provider, env = process.env }) {
  const config = configuration(env);
  let cached, pending, expires = 0;
  const inactive = () => ({ mode: config.mode, status: config.invalid ? 'configuration-error' : 'disabled', plans: [] });
  async function catalog() {
    if (!config.enabled) return inactive();
    if (cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const plans = [];
        let offset = 0;
        while (true) {
          const page = await bounded(() => provider.getPlanList({ payerType: 'org', limit: 100, offset }));
          plans.push(...page.data.filter(p => p.forPayerType === 'org' && p.publiclyVisible).map(plan));
          offset += page.data.length;
          if (!page.data.length || offset >= page.totalCount) break;
        }
        return { mode: config.mode, status: 'ready', plans };
      } catch (error) { return { mode: config.mode, ...unavailable(error), plans: [] }; }
    })();
    try { cached = await pending; expires = Date.now() + 30000; return cached; }
    finally { pending = null; }
  }
  async function subscription(orgId) {
    if (!config.enabled) return inactive();
    if (!orgId) throw new Error('An active organization is required.');
    try {
      const value = await bounded(() => provider.getOrganizationBillingSubscription(orgId));
      return {
        mode: config.mode, status: 'ready', organizationId: orgId,
        subscription: {
          status: value.status,
          items: (value.subscriptionItems || []).map(item => ({
            name: item.plan?.name || 'Subscription', status: item.status,
            period: item.planPeriod, periodEnd: item.periodEnd, isFreeTrial: Boolean(item.isFreeTrial)
          }))
        }
      };
    } catch (error) {
      if (error?.errors?.some(e => e.code === 'resource_not_found')) {
        return { mode: config.mode, status: 'ready', organizationId: orgId, subscription: null };
      }
      return { mode: config.mode, ...unavailable(error) };
    }
  }
  return { catalog, subscription };
}

module.exports = { configuration, create };
