import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartPlan } from '../src/order/cart-builder.mjs';

test('buildCartPlan matches menu items and computes subtotal', () => {
  const order = {
    restaurantUrl: 'https://www.rappi.com.ar/restaurantes/demo',
    items: [
      { name: 'Pizza Muzzarella', quantity: 2 },
      { name: 'Faina', quantity: 1 }
    ]
  };

  const menu = {
    restaurantName: 'Demo Pizzeria',
    items: [
      { id: 'pizza-1', name: 'Pizza Muzzarella', price: 8500 },
      { id: 'empanada-1', name: 'Empanada Carne', price: 1900 }
    ]
  };

  const cart = buildCartPlan({ order, menu });

  assert.equal(cart.matchedItems.length, 1);
  assert.equal(cart.unresolvedItems.length, 1);
  assert.equal(cart.totals.subtotal, 17000);
  assert.equal(cart.safeMode.realPurchaseDisabled, true);
});
