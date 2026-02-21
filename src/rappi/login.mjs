import path from 'node:path';
import { ask } from '../utils/prompt.mjs';
import { ensureDirSecure, writeJsonSecureAtomic } from '../utils/fs.mjs';
import { loadPlaywright } from './playwright-loader.mjs';

export async function bootstrapLogin({ baseUrl, sessionFile, headless = false, slowMo = 0 }) {
  const sessionDir = path.dirname(sessionFile);
  ensureDirSecure(sessionDir);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({ locale: 'es-AR' });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    console.log('\nManual login bootstrap started.');
    console.log('1) Complete Google sign-in in the opened browser.');
    console.log('2) Complete any phone OTP challenge.');
    console.log('3) Return to this terminal when your account home is visible.\n');

    await ask('Press ENTER when login is complete and stable: ');
    console.log('Capturing authenticated session state...');

    await page.waitForTimeout(1200);
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // If UI keeps long-polling, continue with captured state.
    }

    const currentUrl = page.url();
    const state = await context.storageState();
    writeJsonSecureAtomic(sessionFile, state);

    const cookieCount = Array.isArray(state.cookies) ? state.cookies.length : 0;
    const originCount = Array.isArray(state.origins) ? state.origins.length : 0;
    const looksAuthenticated = cookieCount > 0 || originCount > 0;

    console.log(`Session state stored at ${sessionFile}`);
    console.log(`Captured URL: ${currentUrl}`);
    console.log(`Session details: ${cookieCount} cookies, ${originCount} origins.`);
    if (!looksAuthenticated) {
      console.warn('Warning: captured state has no cookies/origins. Login may not be fully completed.');
    }
    console.log('Protect this file as secret material (contains auth tokens).');
  } finally {
    await context.close();
    await browser.close();
  }
}
