import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRestaurantUrl } from '../src/rappi/policy.mjs';

test('assertRestaurantUrl accepts restaurant paths', () => {
  const url = assertRestaurantUrl('https://www.rappi.com.ar/restaurantes/pizzeria-demo');
  assert.match(url, /restaurantes/);
});

test('assertRestaurantUrl blocks non-restaurant paths', () => {
  assert.throws(
    () => assertRestaurantUrl('https://www.rappi.com.ar/supermercado/demo'),
    /Only restaurant URLs are supported/
  );
});
