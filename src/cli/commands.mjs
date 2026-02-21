import path from 'node:path';
import { getConfig, normalizeBoolean } from '../config.mjs';
import { bootstrapLogin } from '../rappi/login.mjs';
import { createBrowserContext } from '../rappi/browser.mjs';
import { searchRestaurants } from '../rappi/restaurants.mjs';
import { fetchMenu } from '../rappi/menu.mjs';
import { parseOrderLikeFile } from '../order/parse.mjs';
import { buildCartPlan } from '../order/cart-builder.mjs';
import { buildDryRunSummary, guardPaymentExecution } from '../rappi/checkout.mjs';
import { exists, readJson, writeJsonSecure } from '../utils/fs.mjs';

export async function runCommand(positionals, options) {
  const config = getConfig();
  const [group, action] = positionals;

  if (group === 'login' && action === 'bootstrap') {
    return runLoginBootstrap(options, config);
  }

  if (group === 'restaurants' && action === 'search') {
    return runRestaurantsSearch(options, config);
  }

  if (group === 'menu' && action === 'fetch') {
    return runMenuFetch(options, config);
  }

  if (group === 'cart' && action === 'build') {
    return runCartBuild(options, config);
  }

  if (group === 'checkout' && action === 'dry-run') {
    return runCheckoutDryRun(options);
  }

  if (group === 'reorder') {
    return runReorder(options, config);
  }

  throw new Error(`Unknown command: ${positionals.join(' ')}`);
}

async function runLoginBootstrap(options, config) {
  await bootstrapLogin({
    baseUrl: config.baseUrl,
    sessionFile: options['session-file'] || config.sessionFile,
    headless: normalizeBoolean(options.headless, false),
    slowMo: Number(options.slowmo || config.slowMo || 0)
  });
}

async function runRestaurantsSearch(options, config) {
  requireSession(config.sessionFile);

  const query = String(options.query || '').trim();
  if (!query) {
    throw new Error('restaurants search requires --query');
  }

  const ctx = await createBrowserContext({
    sessionFile: config.sessionFile,
    headless: normalizeBoolean(options.headless, config.headless),
    slowMo: Number(options.slowmo || config.slowMo || 0)
  });

  try {
    const page = await ctx.context.newPage();
    const data = await searchRestaurants(page, {
      baseUrl: config.baseUrl,
      query,
      city: options.city || config.defaultCity,
      max: Number(options.max || 20),
      minRating: options['min-rating'] !== undefined ? Number(options['min-rating']) : undefined,
      deliveryFeeMax: options['delivery-fee-max'] !== undefined ? Number(options['delivery-fee-max']) : undefined
    });

    printData(data, options.json);
  } finally {
    await ctx.close();
  }
}

async function runMenuFetch(options, config) {
  requireSession(config.sessionFile);
  const restaurantUrl = String(options['restaurant-url'] || '').trim();
  if (!restaurantUrl) {
    throw new Error('menu fetch requires --restaurant-url');
  }

  const ctx = await createBrowserContext({
    sessionFile: config.sessionFile,
    headless: normalizeBoolean(options.headless, config.headless),
    slowMo: Number(options.slowmo || config.slowMo || 0)
  });

  try {
    const page = await ctx.context.newPage();
    const menu = await fetchMenu(page, { restaurantUrl });

    if (options.out) {
      writeJsonSecure(path.resolve(String(options.out)), menu);
    }

    printData(menu, options.json || !options.out);
  } finally {
    await ctx.close();
  }
}

async function runCartBuild(options, config) {
  const orderFile = options['order-file'];
  if (!orderFile) {
    throw new Error('cart build requires --order-file');
  }

  const order = await parseOrderLikeFile(path.resolve(String(orderFile)));
  let menu = null;

  if (options['menu-file']) {
    menu = readJson(path.resolve(String(options['menu-file'])));
  } else if (order.restaurantUrl) {
    requireSession(config.sessionFile);
    const ctx = await createBrowserContext({
      sessionFile: config.sessionFile,
      headless: normalizeBoolean(options.headless, config.headless),
      slowMo: Number(options.slowmo || config.slowMo || 0)
    });
    try {
      const page = await ctx.context.newPage();
      menu = await fetchMenu(page, { restaurantUrl: order.restaurantUrl });
    } finally {
      await ctx.close();
    }
  } else {
    throw new Error('Provide --menu-file or set restaurantUrl in the order file for live menu fetch.');
  }

  const cart = buildCartPlan({ order, menu });
  if (options.out) {
    writeJsonSecure(path.resolve(String(options.out)), cart);
    console.log(`Cart plan written to ${path.resolve(String(options.out))}`);
  }

  printData(cart, options.json || !options.out);
}

async function runCheckoutDryRun(options) {
  const cartFile = options['cart-file'];
  if (!cartFile) {
    throw new Error('checkout dry-run requires --cart-file');
  }

  const cart = readJson(path.resolve(String(cartFile)));
  const summary = buildDryRunSummary(cart);
  printData(summary, true);

  const payment = await guardPaymentExecution(Boolean(options['confirm-pay']));
  console.log('\nPayment gate:');
  console.log(payment.message);
}

async function runReorder(options, config) {
  const templateFile = options.template;
  if (!templateFile) {
    throw new Error('reorder requires --template');
  }

  const order = await parseOrderLikeFile(path.resolve(String(templateFile)));
  const delegatedOptions = {
    ...options,
    'order-file': String(templateFile)
  };

  await runCartBuild(delegatedOptions, config);
}

function printData(data, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    console.table(data);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

function requireSession(sessionFile) {
  if (!exists(sessionFile)) {
    throw new Error(
      `No session state found at ${sessionFile}. Run 'rappi-cli login bootstrap' first to perform manual Google + OTP login.`
    );
  }
}
