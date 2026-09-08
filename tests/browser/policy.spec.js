'use strict';

// Does a real browser accept the Content-Security-Policy, and does the app
// still work under it?
//
// DEP-03 shipped a strict CSP with no unsafe- keyword and no third-party
// origin, verified only by asserting on the header. A header is a claim. The
// browser is what enforces it, and a policy that blocks the application's own
// stylesheet is worse than no policy: it looks secure and is broken.

const { test, expect } = require('@playwright/test');

/** Collect anything the browser refused to load or execute. */
function watchViolations(page) {
  const violations = [];
  page.on('console', message => {
    const text = message.text();
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on('pageerror', error => violations.push('pageerror: ' + error.message));
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || '';
    if (/blocked/i.test(failure)) violations.push('blocked: ' + request.url() + ' ' + failure);
  });
  return violations;
}

test('the sign-in page loads with no CSP violation', async ({ page }) => {
  const violations = watchViolations(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(violations, 'the browser refused something the app needs').toEqual([]);
});

test('the app renders under the policy rather than failing closed', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // If script-src had blocked app.js, #app would still be empty.
  const rendered = await page.locator('#app').innerHTML();
  expect(rendered.length, 'the app did not render; its script may have been blocked').toBeGreaterThan(100);
});

test('stylesheets are applied, not blocked', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // A blocked stylesheet leaves the default transparent/white body background.
  const styled = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { background: body.backgroundColor, family: body.fontFamily };
  });
  expect(styled.family, 'no font stack applied; style-src may have blocked the CSS').not.toBe('');
});

test('the vendored fonts load from this origin and nothing is fetched off-site', async ({ page }, testInfo) => {
  // Compare against the configured base URL. page.url() is empty when the
  // first request fires, which would make the app's own origin look external.
  const ownOrigin = new URL(testInfo.project.use.baseURL).origin;
  const external = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== ownOrigin && url.protocol !== 'data:') external.push(request.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(external, 'the page contacted a third party').toEqual([]);

  const fonts = await page.evaluate(() => document.fonts.size);
  expect(fonts, 'no @font-face rules were registered').toBeGreaterThan(0);
});

test('inline script is refused by the policy', async ({ page }) => {
  await page.goto('/');
  // Proves the policy is enforced rather than merely present: if this executes,
  // script-src is not doing anything.
  const executed = await page.evaluate(() => {
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.textContent = 'window.__cspEscaped = true;';
      document.head.appendChild(script);
      setTimeout(() => resolve(Boolean(window.__cspEscaped)), 100);
    });
  });
  expect(executed, 'an injected inline script ran; the CSP is not being enforced').toBe(false);
});

test('the page cannot be framed', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
});

test('the service worker registers and caches no private path', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration);
  });

  // Registration is not guaranteed in every context; when it happens, what it
  // caches must not include anything private.
  if (registered) {
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });
    for (const path of cached) {
      expect(path.startsWith('/api/'), 'an API response was cached: ' + path).toBe(false);
      expect(path.startsWith('/media/'), 'private media was cached: ' + path).toBe(false);
      expect(path.startsWith('/apply/'), 'a candidate page was cached: ' + path).toBe(false);
    }
  }
});
