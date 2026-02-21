import path from 'node:path';
import { ask } from '../utils/prompt.mjs';
import { ensureDirSecure } from '../utils/fs.mjs';
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
    await context.storageState({ path: sessionFile });
    console.log(`Session state stored at ${sessionFile}`);
    console.log('Protect this file as secret material (contains auth tokens).');
  } finally {
    await context.close();
    await browser.close();
  }
}
