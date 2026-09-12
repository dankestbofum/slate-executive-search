'use strict';

// Opt-in smoke check against the running Clerk-enabled development app.
// Opens forms without creating accounts, sending email, or reading credentials.
const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const baseURL = process.env.SLATE_URL || 'http://localhost:4173';
(async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
    await page.goto(baseURL);
    const signIn = page.getByRole('button', { name:'Sign in', exact:true });
    await expect(signIn).toBeEnabled({ timeout:45000 });
    await expect(page.getByRole('button', { name:'Sign up', exact:true })).toBeVisible();
    await expect(page.getByRole('button', { name:'Start', exact:true })).toHaveCount(0);
    fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive:true });
    await page.screenshot({ path:'test-results/clerk-landing.png', fullPage:true, animations:'disabled' });
    await signIn.click();
    await expect(page.getByRole('textbox', { name:/email/i }).first()).toBeVisible();
    await page.screenshot({ path:'test-results/clerk-sign-in.png', fullPage:true, animations:'disabled' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name:'Sign up', exact:true }).click();
    await expect(page.getByRole('textbox', { name:/email/i }).first()).toBeVisible();
    await page.screenshot({ path:'test-results/clerk-sign-up.png', fullPage:true, animations:'disabled' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width:390, height:844 });
    await expect(signIn).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path:'test-results/clerk-mobile.png', fullPage:true, animations:'disabled' });
    expect(errors).toEqual([]);
    console.log('PASS  Live Clerk landing, sign-in and sign-up forms, mobile layout, and browser CSP');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
