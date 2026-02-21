import { exists } from '../utils/fs.mjs';
import { loadPlaywright } from './playwright-loader.mjs';

export async function createBrowserContext({ sessionFile, headless = false, slowMo = 0 }) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({
    storageState: exists(sessionFile) ? sessionFile : undefined,
    locale: 'es-AR'
  });

  return {
    browser,
    context,
    async close() {
      await context.close();
      await browser.close();
    }
  };
}
