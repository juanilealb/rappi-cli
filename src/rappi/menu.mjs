import { assertRestaurantUrl, assertRestaurantVertical } from './policy.mjs';
import { textToNumber, slugify } from './dom-utils.mjs';

export async function fetchMenu(page, { restaurantUrl }) {
  const safeUrl = assertRestaurantUrl(restaurantUrl);
  await page.goto(safeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const restaurantName = (await page.locator('h1').first().innerText().catch(() => '')).trim() || 'Unknown restaurant';
  assertRestaurantVertical(restaurantName);

  const rawItems = await page.$$eval(
    '[data-testid*="product"], [data-qa*="product"], article, li',
    (nodes) => {
      return nodes.slice(0, 800).map((node) => {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const section = node.closest('section');
        const categoryTitle = section?.querySelector('h2, h3, [data-testid*="title"]')?.textContent?.trim() || '';
        return {
          text,
          categoryTitle
        };
      });
    }
  );

  const dedup = new Map();
  for (const item of rawItems) {
    if (!item.text || !item.text.includes('$')) {
      continue;
    }

    const parsed = parseMenuCandidate(item.text);
    if (!parsed) {
      continue;
    }

    const id = `${slugify(parsed.name)}-${Math.round(parsed.price || 0)}`;
    if (!dedup.has(id)) {
      dedup.set(id, {
        id,
        name: parsed.name,
        description: parsed.description,
        price: parsed.price,
        category: item.categoryTitle || 'General'
      });
    }
  }

  return {
    restaurantName,
    restaurantUrl: safeUrl,
    scrapedAt: new Date().toISOString(),
    itemCount: dedup.size,
    items: Array.from(dedup.values())
  };
}

function parseMenuCandidate(text) {
  const priceMatch = text.match(/\$\s*([0-9.,]+)/);
  if (!priceMatch) {
    return null;
  }

  const price = textToNumber(priceMatch[1]);
  const beforePrice = text.slice(0, priceMatch.index).trim();
  const afterPrice = text.slice(priceMatch.index + priceMatch[0].length).trim();

  let name = beforePrice.split(' ').slice(0, 9).join(' ').trim();
  if (!name || name.length < 3) {
    name = text.split(' ').slice(0, 9).join(' ').trim();
  }

  if (!name || name.length < 3) {
    return null;
  }

  const description = afterPrice.slice(0, 180);
  return { name, price, description };
}
