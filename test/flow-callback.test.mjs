import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFlowState,
  parseFlowCallbackData,
  runFlowCallback
} from '../src/flow/callback.mjs';

test('parseFlowCallbackData parses supported callback patterns', () => {
  assert.deepEqual(parseFlowCallbackData('rappi:menu:start'), { type: 'menu:start', raw: 'rappi:menu:start' });
  assert.deepEqual(parseFlowCallbackData('rappi:menu:more:2'), {
    type: 'menu:more',
    page: 2,
    raw: 'rappi:menu:more:2'
  });
  assert.deepEqual(parseFlowCallbackData('rappi:add:burger-5000'), {
    type: 'add',
    itemId: 'burger-5000',
    raw: 'rappi:add:burger-5000'
  });
  assert.deepEqual(parseFlowCallbackData('rappi:confirm:pay'), {
    type: 'confirm:pay',
    raw: 'rappi:confirm:pay'
  });
  assert.throws(() => parseFlowCallbackData('bad:data'), /Invalid callback data/);
});

test('runFlowCallback transitions cart and checkout states', async () => {
  const state = createInitialFlowState('https://www.rappi.com.ar/restaurantes/215137-guber');

  const menuPayload = await runFlowCallback({
    callbackData: 'rappi:menu:start',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json',
    deps: {
      fetchMenuItems: async () => ({
        scrapedAt: '2026-02-21T00:00:00.000Z',
        items: [
          { id: 'burger-5000', name: 'Burger Clasica', price: 5000 },
          { id: 'papas-2000', name: 'Papas Fritas', price: 2000 }
        ]
      })
    }
  });

  assert.equal(state.stage, 'menu');
  assert.match(menuPayload.message, /Menu real/);
  assert.equal(menuPayload.buttons.at(-1)[0].callback_data, 'rappi:abort');

  await runFlowCallback({
    callbackData: 'rappi:add:burger-5000',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json'
  });
  assert.equal(state.cartItems['burger-5000'], 1);
  assert.equal(state.checkoutConfirmed, false);

  const summaryPayload = await runFlowCallback({
    callbackData: 'rappi:checkout:summary',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json'
  });

  assert.equal(state.stage, 'checkout-summary');
  assert.match(summaryPayload.message, /Burger Clasica/);

  const checkoutPayload = await runFlowCallback({
    callbackData: 'rappi:confirm:checkout',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json'
  });

  assert.equal(state.checkoutConfirmed, true);
  assert.equal(state.stage, 'checkout-confirmed');
  assert.match(checkoutPayload.message, /Checkout confirmado/);

  const blockedPayPayload = await runFlowCallback({
    callbackData: 'rappi:confirm:pay',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json',
    env: { RAPPI_LIVE_ORDER_ENABLED: 'false' }
  });

  assert.equal(state.stage, 'payment-blocked');
  assert.match(blockedPayPayload.message, /Pago bloqueado/);

  await runFlowCallback({
    callbackData: 'rappi:abort',
    state,
    restaurantUrl: state.selectedRestaurantUrl,
    sessionFile: '/tmp/fake-session.json'
  });

  assert.deepEqual(state.cartItems, {});
  assert.equal(state.checkoutConfirmed, false);
  assert.equal(state.stage, 'aborted');
});
