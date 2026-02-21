import { assertRestaurantVertical } from './policy.mjs';
import { textToNumber } from './dom-utils.mjs';

export function buildRestaurantsSearchUrl(baseUrl, query, city) {
  const url = new URL('/restaurantes', baseUrl);
  if (query) {
    url.searchParams.set('query', query);
  }
  if (city) {
    url.searchParams.set('city', city);
  }
  return url.toString();
}

export async function searchRestaurants(page, { baseUrl, query, city, max = 20, minRating, deliveryFeeMax }) {
  const searchUrl = buildRestaurantsSearchUrl(baseUrl, query, city);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const raw = await page.$$eval('a[href*="/restaurantes/"], a[href*="/restaurant/"]', (anchors) => {
    return anchors.map((a) => {
      const card = a.closest('article,li,div') || a;
      const href = a.href || a.getAttribute('href') || '';
      const anchorText = (a.textContent || '').trim().replace(/\s+/g, ' ');
      const textBlob = (card.textContent || '').trim().replace(/\s+/g, ' ');
      return { href, anchorText, textBlob };
    });
  });

  const dedup = new Map();
  for (const item of raw) {
    if (!item.href || dedup.has(item.href)) {
      continue;
    }

    const rating = parseRating(item.textBlob);
    const deliveryFee = parseDeliveryFee(item.textBlob);
    const name = pickRestaurantName(item);

    dedup.set(item.href, {
      name,
      url: item.href,
      rating,
      deliveryFee,
      snippet: item.textBlob.slice(0, 220)
    });
  }

  let results = Array.from(dedup.values());
  for (const restaurant of results) {
    assertRestaurantVertical(restaurant.snippet);
  }

  if (typeof minRating === 'number') {
    results = results.filter((r) => r.rating === null || r.rating >= minRating);
  }

  if (typeof deliveryFeeMax === 'number') {
    results = results.filter((r) => r.deliveryFee === null || r.deliveryFee <= deliveryFeeMax);
  }

  return results.slice(0, max);
}

function pickRestaurantName(item) {
  if (item.anchorText && item.anchorText.length > 2) {
    return item.anchorText;
  }
  const candidate = item.textBlob.split(/\s{2,}|\|/).find((segment) => segment.trim().length > 2);
  return candidate ? candidate.trim() : 'Unknown restaurant';
}

function parseRating(text) {
  const patterns = [
    /(?:★|⭐|rating|calificacion|calificación)\s*([0-9](?:[.,][0-9])?)/i,
    /([0-9](?:[.,][0-9])?)\s*(?:★|⭐)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return textToNumber(match[1]);
    }
  }

  return null;
}

function parseDeliveryFee(text) {
  const patterns = [
    /env(?:í|i)o\s*(?:desde)?\s*\$\s*([0-9.,]+)/i,
    /delivery\s*(?:desde)?\s*\$\s*([0-9.,]+)/i,
    /\$\s*([0-9.,]+)\s*(?:env(?:í|i)o|delivery)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return textToNumber(match[1]);
    }
  }

  return null;
}
