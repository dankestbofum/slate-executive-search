# Organization subscriptions

Clerk Billing supplies organization checkout and subscription management. Stripe
processes payments through Clerk. Candidate browsing and applications stay free.
No commercial plan, price, trial length, or entitlement policy has been invented.
This change is local and has not been deployed.

## App behavior

- `/subscriptions` lists publicly visible organization plans. Personal and hidden
  plans are excluded. The catalog uses a 30-second server cache; browser responses
  remain `no-store`.
- Verified organization administrators can open Clerk's organization PricingTable
  and subscription-details drawer. Other members can read public pricing only.
- The protected summary endpoint derives its organization from verified membership,
  never a submitted payer ID. No card details or Clerk payer objects enter Slate's
  store or API responses. An outage is not treated as an absent subscription.
- Test billing is labelled. Disabled billing, unpublished plans and provider errors
  have distinct messages. Refresh reads current subscription state from Clerk.
- Checkout success redirects to the subscription page and reads the provider again;
  the redirect alone does not confer access or claim a payment succeeded.
- Stripe CSP sources are limited to `/subscriptions`. Applicant pages retain their
  existing stricter policy; subscription and API pages bypass the service worker.

The app does **not yet enforce a paid-plan paywall** on search creation or other
workspace features. Existing roles and search assignments still govern access.
Define paid features and enforce their organization entitlements on the server
before selling plans advertised as unlocking those features.

The original Basic, Enhanced and Executive commercial catalog is now extracted in
[`CLERK_PLAN_MIGRATION.json`](CLERK_PLAN_MIGRATION.json), including original ranges,
descriptions, cumulative features and workflow keys. Its prices remain unpublished:
no exact amount or billing interval was present in the interface. The old sales
cards, comparison matrix and package samples have been removed. Existing search
keys retain their operational behavior under descriptive workflow names; they are
not automatically billing entitlements.

## Activation

1. Log in using `clerk auth login` on the host. The application keys can read
   Billing, but cannot enable it through the CLI's Platform API.
2. With the linked development instance selected, preview
   `clerk enable billing --instance dev --for orgs --no-skills --dry-run`, then
   enable the same organization target. Do not enable personal subscriptions.
3. Configure approved organization plans in the Clerk Dashboard. Keep them
   unpublished until the price, renewal terms and included features are settled.
4. Set `SLATE_BILLING_MODE=test` with matching `pk_test_` / `sk_test_` keys.
   `off` is the default; mismatched keys or an invalid mode disable billing.
5. Exercise a development organization checkout, management, cancellation, past-due
   handling and status refresh using Clerk's test environment. No real charges are
   required for this verification.
6. Production is a separate activation: configure production Clerk organization
   Billing, its Stripe connection and approved plans; test the deployed integration;
   then use matching live keys with `SLATE_BILLING_MODE=live`.

At implementation time, development Clerk returned `billing_not_enabled` and the
host CLI reported no account login. Provider activation and a real test checkout
are therefore outstanding. No paid plans were created or charges made.
The local ignored `.env` now uses test mode; production configuration was not changed.

## Verification

- `node scripts/check.js`: 101 files parsed, no failures; packaging check passed.
- `node tests/run.js`: complete server suite passed, exit 0, including billing
  configuration, plan privacy, provider failure and verified administrator checks.
- `billing.spec.js` and `welcome.spec.js`: all 21 selected cases passed across
  Chrome, WebKit and Pixel 7 emulation. Three pricing cases first caught a heading
  hierarchy error; that was fixed and all three passed on rerun. Accessibility and
  width checks passed; public pricing screenshots were visually reviewed.
- Browser billing tests substitute Clerk's hosted component and billing responses;
  they do not establish a successful hosted checkout. No paid calls are made.
- `git diff --check`: passed.

The subsequent plan extraction removes all three legacy fee ranges from runtime
code and preserves 7, 13 and 17 cumulative features for Basic, Enhanced and
Executive. Browser coverage now includes the old package bookmark and a real
search saved with its existing workflow. All 24 selected billing/welcome cases
passed after correcting the workflow selector's explicit label; the 12 affected
migration and welcome cases passed on rerun. Clerk CLI 3.3.0 was installed globally
at the user's request. Account login and provider-side plan creation remain pending.

## Provider integration details

The server uses `clerkClient.billing.getPlanList` and
`getOrganizationBillingSubscription` from the installed Express SDK. The browser
uses `mountPricingTable` with `for: 'organization'`.

This vanilla JavaScript app isolates Clerk's experimental
`__internal_openSubscriptionDetails({ for: 'organization' })` in `public/auth.js`.
It checks method availability and the active organization before opening. If the
method changes, the app displays an error; it never falls back to personal billing
or the full organization profile, which could expose unrelated membership actions.
The current ClerkJS 6 / UI 1 CDN major versions are not exact-version pins, so a
hosted component smoke test and version pinning remain release requirements before
paid launch. Offline browser fixtures test Slate's integration, not provider UI.

References: [Clerk B2B Billing](https://clerk.com/docs/js-frontend/guides/billing/for-b2b),
[PricingTable](https://clerk.com/docs/js-frontend/reference/components/billing/pricing-table),
[subscription details](https://clerk.com/docs/nextjs/reference/components/billing/subscription-details-button),
[CSP requirements](https://clerk.com/docs/guides/secure/best-practices/csp-headers).
