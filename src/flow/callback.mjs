import path from 'node:path';
import { normalizeBoolean } from '../config.mjs';
import { exists, readJson, writeJsonSecureAtomic } from '../utils/fs.mjs';
import { createBrowserContext } from '../rappi/browser.mjs';
import { fetchMenu } from '../rappi/menu.mjs';
import { assertRestaurantUrl } from '../rappi/policy.mjs';

export const DEFAULT_CALLBACK_RESTAURANT_URL = 'https://www.rappi.com.ar/restaurantes/215137-guber';
const DEFAULT_STAGE = 'idle';
const MENU_PAGE_SIZE = 6;

export function parseFlowCallbackData(callbackData) {
  const raw = String(callbackData || '').trim();
  if (!raw.startsWith('rappi:')) {
    throw new Error(`Invalid callback data: ${raw}`);
  }

  if (raw === 'rappi:menu:start') {
    return { type: 'menu:start', raw };
  }

  if (raw.startsWith('rappi:menu:more:')) {
    const page = Number(raw.slice('rappi:menu:more:'.length));
    if (!Number.isInteger(page) || page < 0) {
      throw new Error(`Invalid menu page in callback data: ${raw}`);
    }
    return { type: 'menu:more', page, raw };
  }

  if (raw.startsWith('rappi:add:')) {
    const itemId = raw.slice('rappi:add:'.length).trim();
    if (!itemId) {
      throw new Error(`Invalid menu item callback data: ${raw}`);
    }
    return { type: 'add', itemId, raw };
  }

  if (raw === 'rappi:checkout:summary') {
    return { type: 'checkout:summary', raw };
  }

  if (raw === 'rappi:confirm:checkout') {
    return { type: 'confirm:checkout', raw };
  }

  if (raw === 'rappi:confirm:pay') {
    return { type: 'confirm:pay', raw };
  }

  if (raw === 'rappi:abort') {
    return { type: 'abort', raw };
  }

  throw new Error(`Unsupported callback data: ${raw}`);
}

export function createInitialFlowState(defaultRestaurantUrl = DEFAULT_CALLBACK_RESTAURANT_URL) {
  return {
    selectedRestaurantUrl: assertRestaurantUrl(defaultRestaurantUrl),
    menuCache: {
      restaurantUrl: '',
      fetchedAt: '',
      items: []
    },
    cartItems: {},
    stage: DEFAULT_STAGE,
    checkoutConfirmed: false
  };
}

export function normalizeFlowState(rawState, { defaultRestaurantUrl = DEFAULT_CALLBACK_RESTAURANT_URL } = {}) {
  const baseline = createInitialFlowState(defaultRestaurantUrl);
  const selectedRestaurantUrl = assertRestaurantUrl(
    typeof rawState?.selectedRestaurantUrl === 'string' && rawState.selectedRestaurantUrl.trim()
      ? rawState.selectedRestaurantUrl
      : baseline.selectedRestaurantUrl
  );

  const cacheRestaurantUrl =
    typeof rawState?.menuCache?.restaurantUrl === 'string' && rawState.menuCache.restaurantUrl.trim()
      ? assertRestaurantUrl(rawState.menuCache.restaurantUrl)
      : '';

  const rawMenuItems = Array.isArray(rawState?.menuCache?.items) ? rawState.menuCache.items : [];
  const items = rawMenuItems.map(sanitizeMenuItem).filter(Boolean);

  const cartItems = sanitizeCartItems(rawState?.cartItems);

  return {
    selectedRestaurantUrl,
    menuCache: {
      restaurantUrl: cacheRestaurantUrl,
      fetchedAt: typeof rawState?.menuCache?.fetchedAt === 'string' ? rawState.menuCache.fetchedAt : '',
      items
    },
    cartItems,
    stage: typeof rawState?.stage === 'string' && rawState.stage.trim() ? rawState.stage : DEFAULT_STAGE,
    checkoutConfirmed: Boolean(rawState?.checkoutConfirmed)
  };
}

export function defaultFlowStateFile(configDir) {
  return path.join(configDir, 'flow-state.json');
}

export function loadFlowState(stateFile, { defaultRestaurantUrl = DEFAULT_CALLBACK_RESTAURANT_URL } = {}) {
  if (!exists(stateFile)) {
    return createInitialFlowState(defaultRestaurantUrl);
  }

  return normalizeFlowState(readJson(stateFile), { defaultRestaurantUrl });
}

export function saveFlowState(stateFile, state) {
  writeJsonSecureAtomic(stateFile, state);
}

export async function runFlowCallback({
  callbackData,
  state,
  restaurantUrl,
  sessionFile,
  headless = false,
  slowMo = 0,
  env = process.env,
  deps = {}
}) {
  const parsed = parseFlowCallbackData(callbackData);
  const selectedRestaurantUrl = assertRestaurantUrl(restaurantUrl || state.selectedRestaurantUrl || DEFAULT_CALLBACK_RESTAURANT_URL);
  state.selectedRestaurantUrl = selectedRestaurantUrl;

  const fetchMenuItems = deps.fetchMenuItems || fetchMenuItemsFromRappi;
  const attemptLivePay = deps.attemptLivePay || attemptLivePayOnCheckout;

  if (parsed.type === 'menu:start') {
    await ensureMenuCached({ state, sessionFile, headless, slowMo, fetchMenuItems });
    state.stage = 'menu';
    return buildMenuPayload(state, 0);
  }

  if (parsed.type === 'menu:more') {
    await ensureMenuCached({ state, sessionFile, headless, slowMo, fetchMenuItems });
    state.stage = 'menu';
    return buildMenuPayload(state, parsed.page);
  }

  if (parsed.type === 'add') {
    state.checkoutConfirmed = false;
    const existing = Number(state.cartItems[parsed.itemId] || 0);
    state.cartItems[parsed.itemId] = existing + 1;
    state.stage = 'cart';

    const item = findMenuItemById(state, parsed.itemId);
    const itemLabel = item ? item.name : parsed.itemId;
    const qty = state.cartItems[parsed.itemId];
    const cartCount = getCartItemCount(state.cartItems);

    return withCancelButton({
      message: `Agregado: ${itemLabel} (x${qty}). Carrito: ${cartCount} item(s).`,
      buttons: [
        [{ text: 'Ver menu', callback_data: 'rappi:menu:start' }],
        [{ text: 'Resumen checkout', callback_data: 'rappi:checkout:summary', style: 'primary' }]
      ]
    });
  }

  if (parsed.type === 'checkout:summary') {
    state.stage = 'checkout-summary';
    const summary = buildCartSummary(state);
    const buttons = [[{ text: 'Volver al menu', callback_data: 'rappi:menu:start' }]];
    if (summary.lines.length > 0) {
      buttons.unshift([{ text: 'Confirmar checkout', callback_data: 'rappi:confirm:checkout', style: 'primary' }]);
    }

    return withCancelButton({
      message: summary.message,
      buttons
    });
  }

  if (parsed.type === 'confirm:checkout') {
    const summary = buildCartSummary(state);
    if (summary.lines.length === 0) {
      state.checkoutConfirmed = false;
      state.stage = 'checkout-blocked';
      return withCancelButton({
        message: 'Checkout bloqueado: el carrito esta vacio. Agrega items antes de confirmar.',
        buttons: [[{ text: 'Ver menu', callback_data: 'rappi:menu:start' }]]
      });
    }

    state.checkoutConfirmed = true;
    state.stage = 'checkout-confirmed';
    return withCancelButton({
      message: `Checkout confirmado. Total estimado: ARS ${formatPrice(summary.total)}. Presiona pagar para intento real.`,
      buttons: [
        [{ text: 'Confirmar pago', callback_data: 'rappi:confirm:pay', style: 'primary' }],
        [{ text: 'Resumen checkout', callback_data: 'rappi:checkout:summary' }]
      ]
    });
  }

  if (parsed.type === 'confirm:pay') {
    const liveEnabled = normalizeBoolean(env.RAPPI_LIVE_ORDER_ENABLED, false);
    if (!state.checkoutConfirmed || !liveEnabled) {
      state.stage = 'payment-blocked';
      const reasons = [];
      if (!state.checkoutConfirmed) {
        reasons.push('checkout no confirmado');
      }
      if (!liveEnabled) {
        reasons.push('RAPPI_LIVE_ORDER_ENABLED=true no configurado');
      }

      return withCancelButton({
        message: `Pago bloqueado: ${reasons.join(' y ')}.`,
        buttons: [[{ text: 'Confirmar checkout', callback_data: 'rappi:confirm:checkout', style: 'primary' }]]
      });
    }

    const attempt = await attemptLivePay({
      sessionFile,
      restaurantUrl: state.selectedRestaurantUrl,
      headless,
      slowMo
    });

    state.stage = attempt.submitted ? 'payment-submitted' : 'payment-attempted';
    return withCancelButton({
      message: attempt.message,
      buttons: [[{ text: 'Resumen checkout', callback_data: 'rappi:checkout:summary' }]]
    });
  }

  if (parsed.type === 'abort') {
    state.cartItems = {};
    state.checkoutConfirmed = false;
    state.stage = 'aborted';
    return withCancelButton({
      message: 'Flujo cancelado. Carrito vaciado.',
      buttons: [[{ text: 'Iniciar menu', callback_data: 'rappi:menu:start' }]]
    });
  }

  throw new Error(`Unhandled callback data: ${callbackData}`);
}

async function ensureMenuCached({ state, sessionFile, headless, slowMo, fetchMenuItems }) {
  const selectedRestaurantUrl = assertRestaurantUrl(state.selectedRestaurantUrl || DEFAULT_CALLBACK_RESTAURANT_URL);
  const cached = state.menuCache;
  const hasCachedMenu =
    cached && cached.restaurantUrl === selectedRestaurantUrl && Array.isArray(cached.items) && cached.items.length > 0;

  if (hasCachedMenu) {
    return;
  }

  const menu = await fetchMenuItems({
    sessionFile,
    restaurantUrl: selectedRestaurantUrl,
    headless,
    slowMo
  });

  state.menuCache = {
    restaurantUrl: selectedRestaurantUrl,
    fetchedAt: menu.scrapedAt || new Date().toISOString(),
    items: Array.isArray(menu.items) ? menu.items.map(sanitizeMenuItem).filter(Boolean) : []
  };
}

function buildMenuPayload(state, pageNumber = 0) {
  const items = Array.isArray(state?.menuCache?.items) ? state.menuCache.items : [];
  const totalPages = Math.max(1, Math.ceil(items.length / MENU_PAGE_SIZE));
  const page = clampPage(pageNumber, totalPages);
  const startIndex = page * MENU_PAGE_SIZE;
  const pageItems = items.slice(startIndex, startIndex + MENU_PAGE_SIZE);

  const buttons = pageItems.map((item) => [
    {
      text: `+ ${item.name} (ARS ${formatPrice(item.price)})`,
      callback_data: `rappi:add:${item.id}`
    }
  ]);

  const navRow = [];
  if (page > 0) {
    navRow.push({ text: 'Pagina anterior', callback_data: `rappi:menu:more:${page - 1}` });
  }
  if (page < totalPages - 1) {
    navRow.push({ text: 'Ver mas', callback_data: `rappi:menu:more:${page + 1}` });
  }
  if (navRow.length > 0) {
    buttons.push(navRow);
  }

  buttons.push([{ text: 'Resumen checkout', callback_data: 'rappi:checkout:summary', style: 'primary' }]);

  if (items.length === 0) {
    return withCancelButton({
      message: 'No se pudo extraer menu real de este restaurante. Intenta nuevamente.',
      buttons: [[{ text: 'Reintentar menu', callback_data: 'rappi:menu:start' }]]
    });
  }

  return withCancelButton({
    message: `Menu real ${page + 1}/${totalPages} - ${state.selectedRestaurantUrl}`,
    buttons
  });
}

function buildCartSummary(state) {
  const lines = [];
  let total = 0;

  for (const [itemId, qty] of Object.entries(state.cartItems || {})) {
    const quantity = Number(qty || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const item = findMenuItemById(state, itemId);
    const unitPrice = Number(item?.price || 0);
    const lineTotal = unitPrice * quantity;
    total += lineTotal;

    lines.push({
      itemId,
      name: item?.name || itemId,
      quantity,
      unitPrice,
      lineTotal
    });
  }

  if (lines.length === 0) {
    return {
      lines,
      total,
      message: 'Carrito vacio. Selecciona productos desde el menu.'
    };
  }

  const detail = lines
    .map((line) => `${line.quantity}x ${line.name} - ARS ${formatPrice(line.lineTotal)}`)
    .join('\n');

  return {
    lines,
    total,
    message: `Resumen checkout:\n${detail}\nTotal: ARS ${formatPrice(total)}`
  };
}

function findMenuItemById(state, itemId) {
  const items = Array.isArray(state?.menuCache?.items) ? state.menuCache.items : [];
  return items.find((item) => item.id === itemId);
}

function getCartItemCount(cartItems) {
  return Object.values(cartItems || {}).reduce((acc, qty) => acc + Number(qty || 0), 0);
}

function sanitizeMenuItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const id = String(item.id || '').trim();
  const name = String(item.name || '').trim();
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    price: Number(item.price || 0),
    description: String(item.description || ''),
    category: String(item.category || 'General')
  };
}

function sanitizeCartItems(rawCartItems) {
  if (!rawCartItems || typeof rawCartItems !== 'object') {
    return {};
  }

  const output = {};
  for (const [itemId, qty] of Object.entries(rawCartItems)) {
    const quantity = Number(qty);
    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) {
      continue;
    }
    output[itemId] = quantity;
  }
  return output;
}

function clampPage(page, totalPages) {
  if (!Number.isInteger(page) || page < 0) {
    return 0;
  }
  return Math.min(page, Math.max(0, totalPages - 1));
}

function formatPrice(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(numeric));
}

function withCancelButton(payload) {
  return {
    message: payload.message,
    buttons: [
      ...(Array.isArray(payload.buttons) ? payload.buttons : []),
      [{ text: 'Cancelar', callback_data: 'rappi:abort', style: 'danger' }]
    ]
  };
}

async function fetchMenuItemsFromRappi({ sessionFile, restaurantUrl, headless, slowMo }) {
  ensureSession(sessionFile);
  const safeRestaurantUrl = assertRestaurantUrl(restaurantUrl);
  const ctx = await createBrowserContext({
    sessionFile,
    headless,
    slowMo: Number(slowMo || 0)
  });

  try {
    const page = await ctx.context.newPage();
    return await fetchMenu(page, { restaurantUrl: safeRestaurantUrl });
  } finally {
    await ctx.close();
  }
}

export async function attemptLivePayOnCheckout({ sessionFile, restaurantUrl, headless, slowMo }) {
  ensureSession(sessionFile);
  const safeRestaurantUrl = assertRestaurantUrl(restaurantUrl);

  const ctx = await createBrowserContext({
    sessionFile,
    headless,
    slowMo: Number(slowMo || 0)
  });

  try {
    const page = await ctx.context.newPage();
    await page.goto(safeRestaurantUrl, { waitUntil: 'domcontentloaded' });

    const checkoutUrl = new URL('/checkout', safeRestaurantUrl).toString();
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});

    const placeOrderButton = page.locator("[data-qa='place-order-button']").first();
    const visible = await placeOrderButton.isVisible({ timeout: 7000 }).catch(() => false);

    if (!visible) {
      return {
        attempted: true,
        submitted: false,
        message: 'Pago en vivo habilitado, pero no se encontro el boton data-qa="place-order-button" en checkout.'
      };
    }

    await placeOrderButton.click({ timeout: 7000 });
    return {
      attempted: true,
      submitted: true,
      message: 'Intento de compra en vivo ejecutado: click en data-qa="place-order-button".'
    };
  } catch (error) {
    return {
      attempted: true,
      submitted: false,
      message: `Intento de compra en vivo fallido: ${error.message}`
    };
  } finally {
    await ctx.close();
  }
}

function ensureSession(sessionFile) {
  if (!exists(sessionFile)) {
    throw new Error(
      `No session state found at ${sessionFile}. Run 'rappi-cli login bootstrap' first to perform manual Google + OTP login.`
    );
  }
}
