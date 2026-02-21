import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuCandidate } from '../src/rappi/menu.mjs';

test('parseMenuCandidate parses structured menu card fields', () => {
  const parsed = parseMenuCandidate({
    nameText: 'Burger Doble',
    descriptionText: 'Medallon smash x2, cheddar y salsa especial.',
    priceText: '$ 12.500',
    rawText: 'Burger Doble $12.500 Medallon smash x2, cheddar y salsa especial.'
  });

  assert.ok(parsed);
  assert.equal(parsed.name, 'Burger Doble');
  assert.equal(parsed.price, 12500);
  assert.match(parsed.description, /medallon smash/i);
});

test('parseMenuCandidate falls back to raw text when structured fields are missing', () => {
  const parsed = parseMenuCandidate({
    rawText: 'Empanada de carne cortada a cuchillo $ 1.900 Masa casera.'
  });

  assert.ok(parsed);
  assert.equal(parsed.name, 'Empanada de carne cortada a cuchillo');
  assert.equal(parsed.price, 1900);
  assert.match(parsed.description, /masa casera/i);
});

test('parseMenuCandidate rejects action-only labels', () => {
  const parsed = parseMenuCandidate({
    nameText: 'Agregar',
    priceText: '$ 2.000',
    rawText: 'Agregar $ 2.000'
  });

  assert.equal(parsed, null);
});

test('parseMenuCandidate rejects section-title artifacts', () => {
  const parsed = parseMenuCandidate({
    nameText: 'Dulces',
    categoryTitle: 'Dulces',
    priceText: '$ 5.000',
    rawText: 'Dulces $ 5.000'
  });

  assert.equal(parsed, null);
});

test('parseMenuCandidate trims concatenated name+description text', () => {
  const parsed = parseMenuCandidate({
    nameText: 'Latte grande Con leche descremada y espuma cremosa ideal para desayuno',
    descriptionText: 'Con leche descremada y espuma cremosa ideal para desayuno',
    priceText: '$ 4.200',
    rawText: 'Latte grande Con leche descremada y espuma cremosa ideal para desayuno $ 4.200'
  });

  assert.ok(parsed);
  assert.equal(parsed.name, 'Latte grande');
  assert.equal(parsed.price, 4200);
});
