import { assertRestaurantUrl, assertRestaurantVertical } from './policy.mjs';
import { textToNumber, slugify } from './dom-utils.mjs';

const MENU_READY_SELECTORS = [
  '[data-testid*="product"]',
  '[data-testid*="menu-item"]',
  '[data-qa*="product"]',
  '[data-qa*="menu-item"]',
  'section h2',
  'h1'
];

const MENU_ITEM_SELECTORS = [
  '[data-testid*="product-card"]',
  '[data-testid*="product"]',
  '[data-testid*="menu-item"]',
  '[data-testid*="dish"]',
  '[data-qa*="product"]',
  '[data-qa*="menu-item"]',
  '[data-qa*="dish"]',
  'article[data-testid]',
  'li[data-testid*="product"]',
  '[role="listitem"]'
];

const MENU_NAME_SELECTORS = [
  '[data-testid*="product-name"]',
  '[data-testid*="menu-item-name"]',
  '[data-testid*="name"]',
  '[data-qa*="product-name"]',
  '[data-qa*="menu-item-name"]',
  '[data-qa*="name"]',
  'h3',
  'h2',
  '[role="heading"]',
  'strong'
];

const MENU_DESCRIPTION_SELECTORS = [
  '[data-testid*="description"]',
  '[data-qa*="description"]',
  'p'
];

const MENU_PRICE_SELECTORS = [
  '[data-testid*="price"]',
  '[data-testid*="amount"]',
  '[data-qa*="price"]',
  '[data-qa*="amount"]',
  'span',
  'p',
  'div'
];

const MENU_SECTION_SELECTORS = [
  '[data-testid*="menu-section"]',
  '[data-testid*="section"]',
  '[data-qa*="menu-section"]',
  '[data-qa*="section"]',
  'section'
];

const CATEGORY_TITLE_SELECTORS = [
  ':scope > h2',
  ':scope > h3',
  ':scope > [role="heading"]',
  ':scope > [data-testid*="title"]',
  ':scope > [data-qa*="title"]',
  'h2',
  'h3',
  '[role="heading"]',
  '[data-testid*="title"]',
  '[data-qa*="title"]'
];

const ACTION_HINTS = ['agregar', 'anadir', 'añadir', 'sumar', 'ver mas', 'ver más', 'personalizar', 'editar'];

export async function fetchMenu(page, { restaurantUrl, maxScrollPasses = 8 }) {
  const safeUrl = assertRestaurantUrl(restaurantUrl);
  await page.goto(safeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
  await waitForMenuReady(page);
  await warmMenuDom(page, { maxScrollPasses });

  const restaurantName = (await page
    .locator('h1, [data-testid*="store-name"], [data-qa*="store-name"]')
    .first()
    .innerText()
    .catch(() => ''))
    .trim() || 'Unknown restaurant';
  assertRestaurantVertical(restaurantName);

  const rawItems = await extractMenuCandidates(page);

  const dedup = new Map();
  for (const item of rawItems) {
    const parsed = parseMenuCandidate(item);
    if (!parsed) {
      continue;
    }

    const duplicateKey = findDuplicateMenuItemKey(dedup, parsed);
    const category = sanitizeCategory(item.categoryTitle);
    if (!duplicateKey) {
      const key = buildStableMenuKey(parsed);
      dedup.set(key, {
        id: buildMenuItemId(parsed),
        name: parsed.name,
        description: parsed.description,
        price: parsed.price,
        category
      });
      continue;
    }

    const existing = dedup.get(duplicateKey);
    existing.name = preferMenuName(existing.name, parsed.name);
    existing.description = existing.description || parsed.description;
    existing.category = preferCategory(existing.category, category);
    existing.id = buildMenuItemId(existing);
  }

  return {
    restaurantName,
    restaurantUrl: safeUrl,
    scrapedAt: new Date().toISOString(),
    itemCount: dedup.size,
    items: Array.from(dedup.values())
  };
}

export function parseMenuCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  const input = typeof candidate === 'string' ? { rawText: candidate } : candidate;
  const rawText = normalizeWhitespace(input.rawText);
  const nameText = normalizeWhitespace(input.nameText);
  const descriptionText = normalizeWhitespace(input.descriptionText);
  const priceText = normalizeWhitespace(input.priceText);
  const categoryTitle = sanitizeCategory(input.categoryTitle);
  const nestedItemCount = Number(input.nestedItemCount);
  const rawPriceMatches = Number(input.rawPriceMatches);

  if (Number.isFinite(nestedItemCount) && nestedItemCount > 3) {
    return null;
  }
  if (Number.isFinite(rawPriceMatches) && rawPriceMatches > 5) {
    return null;
  }

  const price = extractPrice(priceText, { allowBareNumber: true }) ?? extractPrice(rawText);
  if (typeof price !== 'number') {
    return null;
  }

  const name = chooseMenuName({ nameText, descriptionText, rawText, categoryTitle });
  if (!isLikelyMenuName(name)) {
    return null;
  }
  if (isSectionTitleArtifact({ name, categoryTitle, descriptionText, rawText })) {
    return null;
  }

  const description = chooseDescription({ name, descriptionText, rawText });
  return { name, price, description };
}

async function waitForMenuReady(page) {
  await page
    .waitForFunction(
      (selectors) => selectors.some((selector) => document.querySelector(selector)),
      MENU_READY_SELECTORS,
      { timeout: 9000 }
    )
    .catch(() => {});
}

async function warmMenuDom(page, { maxScrollPasses = 8 }) {
  const passes = Number.isFinite(maxScrollPasses) ? Math.max(0, Math.min(12, maxScrollPasses)) : 8;
  for (let index = 0; index < passes; index += 1) {
    const count = await countMenuNodes(page);
    if (count >= 24) {
      break;
    }
    await page
      .evaluate(() => {
        const step = Math.max(340, Math.round(window.innerHeight * 0.85));
        window.scrollBy(0, step);
      })
      .catch(() => {});
    await page.waitForTimeout(450);
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(250);
}

async function countMenuNodes(page) {
  return page
    .evaluate((selectors) => {
      const seen = new Set();
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          seen.add(node);
        }
      }
      return seen.size;
    }, MENU_ITEM_SELECTORS)
    .catch(() => 0);
}

async function extractMenuCandidates(page) {
  return page.evaluate(
    ({ itemSelectors, nameSelectors, descriptionSelectors, priceSelectors, sectionSelectors, categorySelectors }) => {
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const hasCurrency = (text) => /(?:\$|ars?\$?|ar\$)\s*[0-9]/i.test(text);
      const isLikelyCategoryTitle = (value) => {
        const text = clean(value);
        if (!text || text.length < 3 || text.length > 64) {
          return false;
        }
        if (hasCurrency(text) || !/[a-zA-Z\u00C0-\u024F]/.test(text)) {
          return false;
        }
        return true;
      };

      const firstMatchingText = (root, selectors, { currency = false } = {}) => {
        for (const selector of selectors) {
          const nodes = root.querySelectorAll(selector);
          for (const node of nodes) {
            const text = clean(node.textContent);
            if (!text) {
              continue;
            }
            if (!currency || /(?:\$|ars?\$?|ar\$)\s*[0-9]/i.test(text) || /^[0-9][0-9.\s]*(?:,[0-9]{1,2})?$/.test(text)) {
              return text;
            }
          }
        }
        return '';
      };

      const pickCategoryFromContainer = (node, container) => {
        if (!container || !container.contains(node)) {
          return '';
        }

        for (const selector of categorySelectors) {
          let headings = [];
          try {
            headings = container.querySelectorAll(selector);
          } catch {
            continue;
          }

          for (const heading of headings) {
            if (!heading || node.contains(heading)) {
              continue;
            }
            const text = clean(heading.textContent);
            if (isLikelyCategoryTitle(text)) {
              return text;
            }
          }
        }

        return '';
      };

      const resolveCategoryTitle = (node) => {
        for (const sectionSelector of sectionSelectors) {
          const container = node.closest(sectionSelector);
          const category = pickCategoryFromContainer(node, container);
          if (category) {
            return category;
          }
        }

        let sibling = node.previousElementSibling;
        while (sibling) {
          const text = clean(sibling.textContent);
          if (isLikelyCategoryTitle(text) && !hasCurrency(text)) {
            return text;
          }
          if (hasCurrency(text)) {
            break;
          }
          sibling = sibling.previousElementSibling;
        }

        return '';
      };

      const seen = new Set();
      const nodes = [];
      for (const selector of itemSelectors) {
        const selected = document.querySelectorAll(selector);
        for (const node of selected) {
          if (!seen.has(node)) {
            seen.add(node);
            nodes.push(node);
          }
        }
      }

      const fallbackNodes =
        nodes.length > 0
          ? nodes
          : Array.from(document.querySelectorAll('section article, section li, article, li')).slice(0, 1200);

      return fallbackNodes.slice(0, 1600).map((node) => {
        const rawText = clean(node.textContent).slice(0, 600);
        const priceMatches = rawText.match(/(?:\$|ars?\$?|ar\$)\s*[0-9]/gi) || [];
        const nestedItemCount = itemSelectors.reduce((count, selector) => {
          try {
            return count + node.querySelectorAll(selector).length;
          } catch {
            return count;
          }
        }, 0);

        return {
          nameText: firstMatchingText(node, nameSelectors),
          descriptionText: firstMatchingText(node, descriptionSelectors),
          priceText: firstMatchingText(node, priceSelectors, { currency: true }),
          rawText,
          categoryTitle: resolveCategoryTitle(node),
          rawPriceMatches: priceMatches.length,
          nestedItemCount
        };
      });
    },
    {
      itemSelectors: MENU_ITEM_SELECTORS,
      nameSelectors: MENU_NAME_SELECTORS,
      descriptionSelectors: MENU_DESCRIPTION_SELECTORS,
      priceSelectors: MENU_PRICE_SELECTORS,
      sectionSelectors: MENU_SECTION_SELECTORS,
      categorySelectors: CATEGORY_TITLE_SELECTORS
    }
  );
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractPrice(value, { allowBareNumber = false } = {}) {
  const text = normalizeWhitespace(value);
  if (!text) {
    return null;
  }

  const currencyMatch = text.match(/(?:\$|ars?\$?|ar\$)\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/i);
  if (currencyMatch) {
    return textToNumber(currencyMatch[1]);
  }

  if (!allowBareNumber) {
    return null;
  }

  const bareMatch = text.match(/^([0-9][0-9.\s]*(?:,[0-9]{1,2})?)$/);
  return bareMatch ? textToNumber(bareMatch[1]) : null;
}

function chooseMenuName({ nameText, descriptionText, rawText, categoryTitle }) {
  const cleanName = (value) =>
    sanitizeMenuName(
      stripConcatenatedName({
        name: value,
        descriptionText,
        rawText,
        categoryTitle
      })
    );

  const directName = cleanName(nameText);
  if (isLikelyMenuName(directName)) {
    return directName;
  }

  const priceMatch = rawText.match(/(?:\$|ars?\$?|ar\$)\s*[0-9][0-9.\s]*(?:,[0-9]{1,2})?/i);
  const beforePrice = priceMatch ? rawText.slice(0, priceMatch.index).trim() : rawText;
  const fallback = cleanName(beforePrice.split(/[|·•]/)[0]);
  if (isLikelyMenuName(fallback)) {
    return fallback;
  }

  return cleanName(rawText.split(/[|·•]/)[0].split(' ').slice(0, 9).join(' '));
}

function chooseDescription({ name, descriptionText, rawText }) {
  const cleanedName = sanitizeMenuName(name);
  const cleanedDescription = sanitizeDescription(descriptionText);
  if (isLikelyDescription(cleanedDescription, cleanedName)) {
    return cleanedDescription;
  }

  const priceMatch = rawText.match(/(?:\$|ars?\$?|ar\$)\s*[0-9][0-9.\s]*(?:,[0-9]{1,2})?/i);
  if (!priceMatch) {
    return '';
  }

  const tail = sanitizeDescription(rawText.slice(priceMatch.index + priceMatch[0].length));
  return isLikelyDescription(tail, cleanedName) ? tail : '';
}

function isLikelyMenuName(value) {
  const text = sanitizeMenuName(value);
  if (!text || text.length < 3 || text.length > 96) {
    return false;
  }
  if (text.includes('$') || !/[a-zA-Z\u00C0-\u024F]/.test(text)) {
    return false;
  }

  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return !ACTION_HINTS.some((hint) => normalized.includes(hint));
}

function sanitizeMenuName(value) {
  return normalizeWhitespace(value)
    .replace(/^[\-:•·|]+/, '')
    .replace(/\b(?:agregar|añadir|anadir|sumar|personalizar|editar)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeDescription(value) {
  return normalizeWhitespace(value).replace(/\b(?:agregar|añadir|anadir|sumar)\b.*$/i, '').slice(0, 180).trim();
}

function isLikelyDescription(value, name) {
  if (!value || value.length < 6) {
    return false;
  }
  if (value.toLowerCase() === String(name || '').toLowerCase()) {
    return false;
  }
  if (!/[a-zA-Z\u00C0-\u024F]/.test(value)) {
    return false;
  }
  return !/(?:\$|ars?\$?|ar\$)\s*[0-9]/i.test(value);
}

function sanitizeCategory(value) {
  const category = normalizeWhitespace(value);
  if (!category || category.length > 64 || /(?:\$|ars?\$?|ar\$)\s*[0-9]/i.test(category)) {
    return 'General';
  }
  return category;
}

function stripConcatenatedName({ name, descriptionText, rawText, categoryTitle }) {
  let output = sanitizeMenuName(name);
  if (!output) {
    return '';
  }

  const description = sanitizeDescription(descriptionText);
  if (description && output.length > description.length) {
    output = removeTextFragment(output, description);
  }

  const category = sanitizeCategory(categoryTitle);
  if (category !== 'General') {
    output = removeTextFragment(output, category);
  }

  const rawPrefix = extractRawPrefix(rawText);
  if (rawPrefix) {
    const normalizedOutput = normalizeComparable(output);
    const normalizedPrefix = normalizeComparable(rawPrefix);
    if (normalizedOutput.includes(normalizedPrefix) && rawPrefix.length < output.length) {
      output = rawPrefix;
    }
  }

  if (output.split(/\s+/).length > 12) {
    output = output.split(/\s+(?:-|–|—|:)\s+/)[0].trim();
  }

  return sanitizeMenuName(output);
}

function removeTextFragment(text, fragment) {
  const source = normalizeWhitespace(text);
  const target = normalizeWhitespace(fragment);
  if (!source || !target) {
    return source;
  }

  const index = source.toLowerCase().indexOf(target.toLowerCase());
  if (index === -1) {
    return source;
  }

  const removed = `${source.slice(0, index)} ${source.slice(index + target.length)}`.replace(/\s+/g, ' ').trim();
  return removed || source;
}

function extractRawPrefix(rawText) {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return '';
  }
  const priceMatch = text.match(/(?:\$|ars?\$?|ar\$)\s*[0-9][0-9.\s]*(?:,[0-9]{1,2})?/i);
  const beforePrice = priceMatch ? text.slice(0, priceMatch.index).trim() : text;
  return sanitizeMenuName(beforePrice.split(/[|·•]/)[0]);
}

function isSectionTitleArtifact({ name, categoryTitle, descriptionText, rawText }) {
  const cleanName = sanitizeMenuName(name);
  const normalizedName = normalizeComparable(cleanName);
  if (!normalizedName) {
    return true;
  }

  const cleanCategory = sanitizeCategory(categoryTitle);
  if (cleanCategory !== 'General' && normalizedName === normalizeComparable(cleanCategory)) {
    return true;
  }

  if (!sanitizeDescription(descriptionText)) {
    const rawPrefix = extractRawPrefix(rawText);
    if (rawPrefix && normalizeComparable(rawPrefix) === normalizedName && cleanName.split(/\s+/).length <= 4) {
      const normalizedRaw = normalizeComparable(rawText);
      if (normalizedRaw.startsWith(normalizedName)) {
        return true;
      }
    }
  }

  return false;
}

function buildStableMenuKey(item) {
  const normalizedName = normalizeComparable(item?.name).replace(/\s+/g, '-');
  const roundedPrice = Math.round(Number(item?.price) || 0);
  return `${normalizedName || slugify(item?.name || '')}-${roundedPrice}`;
}

function buildMenuItemId(item) {
  return `${slugify(item?.name || '')}-${Math.round(Number(item?.price) || 0)}`;
}

function findDuplicateMenuItemKey(dedup, parsedItem) {
  const stableKey = buildStableMenuKey(parsedItem);
  if (dedup.has(stableKey)) {
    return stableKey;
  }

  const targetName = normalizeComparable(parsedItem.name);
  const targetPrice = Math.round(Number(parsedItem.price) || 0);
  for (const [key, existing] of dedup.entries()) {
    if (Math.round(Number(existing.price) || 0) !== targetPrice) {
      continue;
    }

    const existingName = normalizeComparable(existing.name);
    if (!existingName || !targetName) {
      continue;
    }
    if (existingName === targetName) {
      return key;
    }
    if (existingName.length >= 8 && targetName.length >= 8 && (existingName.includes(targetName) || targetName.includes(existingName))) {
      return key;
    }
  }

  return null;
}

function preferMenuName(currentName, incomingName) {
  const current = sanitizeMenuName(currentName);
  const incoming = sanitizeMenuName(incomingName);
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const normalizedCurrent = normalizeComparable(current);
  const normalizedIncoming = normalizeComparable(incoming);
  if (normalizedCurrent === normalizedIncoming) {
    return current.length <= incoming.length ? current : incoming;
  }
  if (normalizedCurrent.length >= 6 && normalizedIncoming.includes(normalizedCurrent)) {
    return current;
  }
  if (normalizedIncoming.length >= 6 && normalizedCurrent.includes(normalizedIncoming)) {
    return incoming;
  }
  return current;
}

function preferCategory(currentCategory, incomingCategory) {
  const current = sanitizeCategory(currentCategory);
  const incoming = sanitizeCategory(incomingCategory);
  if (current === 'General' && incoming !== 'General') {
    return incoming;
  }
  return current;
}

function normalizeComparable(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
