import { slugify } from '../rappi/dom-utils.mjs';

export function validateOrderTemplate(order) {
  if (!order || typeof order !== 'object') {
    throw new Error('Order template must be an object.');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('Order template must include a non-empty items array.');
  }

  for (const [index, item] of order.items.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid item at index ${index}.`);
    }
    if (!item.name || typeof item.name !== 'string') {
      throw new Error(`Item at index ${index} is missing a valid name.`);
    }
    if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw new Error(`Item '${item.name}' has invalid quantity.`);
    }
  }
}

export function buildCartPlan({ order, menu }) {
  validateOrderTemplate(order);

  const menuItems = Array.isArray(menu?.items) ? menu.items : [];
  const index = buildMenuIndex(menuItems);

  const matchedItems = [];
  const unresolvedItems = [];
  let subtotal = 0;

  for (const entry of order.items) {
    const quantity = entry.quantity || 1;
    const match = findMenuMatch(entry.name, index);

    if (!match) {
      unresolvedItems.push({
        requestedName: entry.name,
        quantity,
        notes: entry.notes || '',
        reason: 'No menu match found'
      });
      continue;
    }

    const lineSubtotal = (match.price || 0) * quantity;
    subtotal += lineSubtotal;

    matchedItems.push({
      menuItemId: match.id,
      name: match.name,
      unitPrice: match.price,
      quantity,
      lineSubtotal,
      notes: entry.notes || '',
      requestedName: entry.name,
      options: Array.isArray(entry.options) ? entry.options : []
    });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceRestaurantUrl: order.restaurantUrl || menu?.restaurantUrl || null,
    sourceRestaurantName: menu?.restaurantName || order.restaurantName || null,
    currency: order.currency || 'ARS',
    matchedItems,
    unresolvedItems,
    totals: {
      subtotal,
      estimatedFees: null,
      grandTotal: subtotal
    },
    safeMode: {
      realPurchaseDisabled: true,
      requiresConfirmPayFlag: true,
      requiresSecondInteractiveConfirmation: true
    }
  };
}

function buildMenuIndex(items) {
  return items.map((item) => ({ ...item, normalizedName: normalize(item.name) }));
}

function findMenuMatch(requestedName, indexedMenu) {
  const target = normalize(requestedName);

  let exact = indexedMenu.find((item) => item.normalizedName === target);
  if (exact) {
    return exact;
  }

  exact = indexedMenu.find((item) => item.normalizedName.includes(target) || target.includes(item.normalizedName));
  if (exact) {
    return exact;
  }

  const targetSlug = slugify(target);
  return indexedMenu.find((item) => slugify(item.normalizedName) === targetSlug) || null;
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
