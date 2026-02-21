import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrderLikeFile } from '../src/order/parse.mjs';
import { buildCartPlan } from '../src/order/cart-builder.mjs';
import { buildDryRunSummary } from '../src/rappi/checkout.mjs';
import { readJson } from '../src/utils/fs.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const orderPath = path.join(root, 'examples/orders/pizza-night.yaml');
const menuPath = path.join(root, 'examples/output/menu-sample.json');

const order = await parseOrderLikeFile(orderPath);
const menu = readJson(menuPath);
const cart = buildCartPlan({ order, menu });
const summary = buildDryRunSummary(cart);

if (!Array.isArray(cart.matchedItems) || cart.matchedItems.length === 0) {
  throw new Error('Smoke check failed: expected at least one matched cart item.');
}

if (summary.safeMode.realPurchaseDisabled !== true) {
  throw new Error('Smoke check failed: realPurchaseDisabled must be true.');
}

console.log('smoke ok');
