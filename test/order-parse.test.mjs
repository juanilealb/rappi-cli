import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/order/parse.mjs';

test('parseYaml parses order template subset', () => {
  const input = `restaurantUrl: https://www.rappi.com.ar/restaurantes/demo\nitems:\n  - name: Pizza Muzzarella\n    quantity: 2\n    notes: sin cebolla\n  - name: Empanada\n    quantity: 3\n`;

  const parsed = parseYaml(input);

  assert.equal(parsed.restaurantUrl, 'https://www.rappi.com.ar/restaurantes/demo');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].name, 'Pizza Muzzarella');
  assert.equal(parsed.items[1].quantity, 3);
});
