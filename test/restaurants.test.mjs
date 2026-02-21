import test from 'node:test';
import assert from 'node:assert/strict';
import { searchRestaurants } from '../src/rappi/restaurants.mjs';

function createMockPage(rawCards) {
  return {
    visitedUrl: '',
    async goto(url) {
      this.visitedUrl = url;
    },
    async waitForTimeout() {},
    async $$eval() {
      return rawCards;
    }
  };
}

test('searchRestaurants prioritizes query intent matches over generic popular chains', async () => {
  const page = createMockPage([
    {
      href: 'https://www.rappi.com.ar/restaurantes/burger-king-palermo',
      anchorText: 'Burger King Palermo',
      textBlob: 'Burger King Palermo Calificacion 4.9 Envio $1200'
    },
    {
      href: 'https://www.rappi.com.ar/restaurantes/sushi-club',
      anchorText: 'Sushi Club',
      textBlob: 'Sushi Club Calificacion 4.5 Envio $1400'
    },
    {
      href: 'https://www.rappi.com.ar/restaurantes/sushipop-centro',
      anchorText: 'Sushipop Centro',
      textBlob: 'Sushipop Centro Calificacion 4.2 Envio $900'
    }
  ]);

  const results = await searchRestaurants(page, {
    baseUrl: 'https://www.rappi.com.ar',
    query: 'sushi',
    city: 'Buenos Aires',
    max: 20
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Sushi Club');
  assert.equal(results[1].name, 'Sushipop Centro');
  assert.ok(results.every((row) => row.name.toLowerCase().includes('sushi')));
  assert.match(page.visitedUrl, /query=sushi/);
});

test('searchRestaurants falls back to broad ranking when query has no textual matches', async () => {
  const page = createMockPage([
    {
      href: 'https://www.rappi.com.ar/restaurantes/pizzeria-uno',
      anchorText: 'Pizzeria Uno',
      textBlob: 'Pizzeria Uno Calificacion 4.1 Envio $1000'
    },
    {
      href: 'https://www.rappi.com.ar/restaurantes/parrilla-dos',
      anchorText: 'Parrilla Dos',
      textBlob: 'Parrilla Dos Calificacion 4.8 Envio $1800'
    }
  ]);

  const results = await searchRestaurants(page, {
    baseUrl: 'https://www.rappi.com.ar',
    query: 'zzzz-no-match',
    city: 'Buenos Aires',
    max: 20
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Parrilla Dos');
  assert.equal(results[1].name, 'Pizzeria Uno');
});

test('searchRestaurants excludes blocked non-restaurant vertical snippets', async () => {
  const page = createMockPage([
    {
      href: 'https://www.rappi.com.ar/restaurantes/pizza-palace',
      anchorText: 'Pizza Palace',
      textBlob: 'Pizza Palace Calificacion 4.4 Envio $1100'
    },
    {
      href: 'https://www.rappi.com.ar/restaurantes/supermercado-combo',
      anchorText: 'Supermercado Combo',
      textBlob: 'Supermercado Combo Turbo Calificacion 5.0 Envio $500'
    }
  ]);

  const results = await searchRestaurants(page, {
    baseUrl: 'https://www.rappi.com.ar',
    query: 'pizza',
    city: 'Buenos Aires',
    max: 20
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Pizza Palace');
});
