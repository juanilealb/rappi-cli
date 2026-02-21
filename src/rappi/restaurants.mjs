import { assertRestaurantUrl, assertRestaurantVertical } from './policy.mjs';
import { textToNumber } from './dom-utils.mjs';

const RESTAURANT_LINK_SELECTOR = 'a[href*="/restaurantes/"], a[href*="/restaurant/"]';
const GENERIC_PATH_SEGMENTS = new Set(['delivery', 'restaurant', 'restaurantes', 'search', 'categoria', 'categorias']);

const STOPWORDS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'los',
  'para',
  'por',
  'un',
  'una',
  'y'
]);

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
  await page.waitForTimeout(1000);
  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  }
  if (typeof page.waitForSelector === 'function') {
    await page.waitForSelector(RESTAURANT_LINK_SELECTOR, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(400);

  const raw = await page.$$eval(RESTAURANT_LINK_SELECTOR, (anchors) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const pushUnique = (list, value) => {
      const text = clean(value);
      if (text && !list.includes(text)) {
        list.push(text);
      }
    };

    const nameSelectors = [
      '[data-testid*="store-name"]',
      '[data-testid*="restaurant-name"]',
      '[data-qa*="store-name"]',
      '[data-qa*="restaurant-name"]',
      'h2',
      'h3',
      'strong',
      '[role="heading"]'
    ];

    return anchors.slice(0, 1200).map((anchor) => {
      const card = anchor.closest('[data-testid*="store"], [data-qa*="store"], article, li, section, div') || anchor;
      const href = anchor.href || anchor.getAttribute('href') || '';
      const nameCandidates = [];

      pushUnique(nameCandidates, anchor.getAttribute('aria-label'));
      pushUnique(nameCandidates, anchor.getAttribute('title'));
      pushUnique(nameCandidates, anchor.textContent);

      for (const selector of nameSelectors) {
        const fromAnchor = anchor.querySelector(selector);
        const fromCard = card.querySelector(selector);
        if (fromAnchor) {
          pushUnique(nameCandidates, fromAnchor.textContent);
        }
        if (fromCard) {
          pushUnique(nameCandidates, fromCard.textContent);
        }
      }

      const shortText = Array.from(card.querySelectorAll('h1,h2,h3,strong,span,p'))
        .map((element) => clean(element.textContent))
        .filter((text) => text.length >= 3 && text.length <= 96)
        .slice(0, 18);

      return {
        href,
        anchorText: clean(anchor.textContent),
        textBlob: clean(card.textContent).slice(0, 700),
        nameCandidates,
        shortText
      };
    });
  });

  const dedup = new Map();
  for (const item of raw) {
    const safeUrl = normalizeAndValidateRestaurantUrl(item.href, baseUrl);
    if (!safeUrl || dedup.has(safeUrl)) {
      continue;
    }

    const rating = parseRating(item.textBlob);
    const deliveryFee = parseDeliveryFee(item.textBlob);
    const name = pickRestaurantName(item);
    const snippet = [item.textBlob, ...(Array.isArray(item.shortText) ? item.shortText : [])]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);

    dedup.set(safeUrl, {
      name,
      url: safeUrl,
      rating,
      deliveryFee,
      snippet
    });
  }

  let results = Array.from(dedup.values()).filter((restaurant) => isAllowedRestaurantSnippet(restaurant.snippet));

  if (typeof minRating === 'number') {
    results = results.filter((r) => r.rating === null || r.rating >= minRating);
  }

  if (typeof deliveryFeeMax === 'number') {
    results = results.filter((r) => r.deliveryFee === null || r.deliveryFee <= deliveryFeeMax);
  }

  results = rankRestaurantsByQuery(results, query);
  return results.slice(0, max);
}

export function pickRestaurantName(item) {
  const candidates = [];
  const pushCandidate = (value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  if (Array.isArray(item?.nameCandidates)) {
    for (const value of item.nameCandidates) {
      pushCandidate(value);
    }
  }
  if (Array.isArray(item?.shortText)) {
    for (const value of item.shortText) {
      pushCandidate(value);
    }
  }
  pushCandidate(item?.anchorText);

  for (const candidate of candidates) {
    const fragment = candidate
      .split(/[|·•]/)
      .map((value) => sanitizeRestaurantName(value))
      .find(isLikelyRestaurantName);
    if (fragment) {
      return fragment;
    }
    const cleanCandidate = sanitizeRestaurantName(candidate);
    if (isLikelyRestaurantName(cleanCandidate)) {
      return cleanCandidate;
    }
  }

  const blobCandidate = String(item?.textBlob || '')
    .split(/\s{2,}|\||·|•/)
    .map((segment) => sanitizeRestaurantName(segment))
    .find(isLikelyRestaurantName);
  if (blobCandidate) {
    return blobCandidate;
  }

  const urlFallback = deriveNameFromRestaurantUrl(item?.href);
  return urlFallback || 'Unknown restaurant';
}

function parseRating(text) {
  const source = String(text || '');
  const patterns = [
    /(?:★|⭐|rating|calificacion|calificación)\s*([0-9](?:[.,][0-9])?)/i,
    /([0-9](?:[.,][0-9])?)\s*(?:★|⭐)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return textToNumber(match[1]);
    }
  }

  return null;
}

export function normalizeAndValidateRestaurantUrl(href, baseUrl) {
  if (!href) {
    return null;
  }
  try {
    const normalized = new URL(href, baseUrl);
    normalized.hash = '';
    normalized.search = '';
    if (!isRestaurantDetailPath(normalized.pathname)) {
      return null;
    }
    return assertRestaurantUrl(normalized.toString());
  } catch {
    return null;
  }
}

function isAllowedRestaurantSnippet(snippet) {
  try {
    assertRestaurantVertical(snippet);
    return true;
  } catch {
    return false;
  }
}

function isLikelyRestaurantName(candidate) {
  if (!candidate || candidate.length < 3 || candidate.length > 90) {
    return false;
  }
  if (candidate.includes('<') || candidate.includes('>') || candidate.includes('$')) {
    return false;
  }
  if (!/[a-zA-Z\u00C0-\u024F]/.test(candidate)) {
    return false;
  }
  const normalized = normalizeText(candidate);
  const rejectedHints = [
    'envio',
    'delivery',
    'calificacion',
    'rating',
    'pedido minimo',
    'desde',
    'agregar',
    'sumar',
    'ver mas'
  ];
  return !rejectedHints.some((hint) => normalized.includes(hint));
}

function rankRestaurantsByQuery(results, query) {
  const queryInfo = buildQueryInfo(query);
  const scored = results.map((restaurant) => {
    const relevance = scoreRestaurantRelevance(restaurant, queryInfo);
    return { ...restaurant, relevance };
  });

  const hasIntentMatches = scored.some((candidate) => candidate.relevance.intentMatch);
  const rankedPool = hasIntentMatches ? scored.filter((candidate) => candidate.relevance.intentMatch) : scored;

  rankedPool.sort((left, right) => {
    if (right.relevance.score !== left.relevance.score) {
      return right.relevance.score - left.relevance.score;
    }
    if ((right.rating ?? -1) !== (left.rating ?? -1)) {
      return (right.rating ?? -1) - (left.rating ?? -1);
    }
    if ((left.deliveryFee ?? Number.POSITIVE_INFINITY) !== (right.deliveryFee ?? Number.POSITIVE_INFINITY)) {
      return (left.deliveryFee ?? Number.POSITIVE_INFINITY) - (right.deliveryFee ?? Number.POSITIVE_INFINITY);
    }
    return left.name.localeCompare(right.name);
  });

  return rankedPool.map(({ relevance, ...restaurant }) => restaurant);
}

function scoreRestaurantRelevance(restaurant, queryInfo) {
  if (!queryInfo.normalizedQuery && queryInfo.tokens.length === 0) {
    return { score: 0, intentMatch: false };
  }

  const fields = {
    name: normalizeText(restaurant.name),
    snippet: normalizeText(restaurant.snippet),
    urlPath: extractNormalizedUrlPath(restaurant.url)
  };

  let score = 0;
  let matchedTokens = 0;

  if (queryInfo.normalizedQuery) {
    if (fields.name.includes(queryInfo.normalizedQuery)) {
      score += 120;
    }
    if (fields.snippet.includes(queryInfo.normalizedQuery)) {
      score += 45;
    }
    if (fields.urlPath.includes(queryInfo.normalizedQuery)) {
      score += 30;
    }
  }

  for (const token of queryInfo.tokens) {
    let tokenScore = 0;
    if (hasWholeWord(fields.name, token)) {
      tokenScore += 30;
    } else if (fields.name.includes(token)) {
      tokenScore += 16;
    }

    if (hasWholeWord(fields.snippet, token)) {
      tokenScore += 10;
    } else if (fields.snippet.includes(token)) {
      tokenScore += 4;
    }

    if (fields.urlPath.includes(token)) {
      tokenScore += 6;
    }

    if (tokenScore > 0) {
      matchedTokens += 1;
      score += tokenScore;
    }
  }

  if (typeof restaurant.rating === 'number') {
    score += Math.max(0, Math.min(restaurant.rating, 5));
  }
  if (restaurant.deliveryFee === 0) {
    score += 1;
  }

  const intentMatch = matchedTokens > 0 || score >= 70;
  return { score, intentMatch };
}

function buildQueryInfo(query) {
  const normalizedQuery = normalizeText(query).trim();
  const tokens = normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  return {
    normalizedQuery,
    tokens: Array.from(new Set(tokens))
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNormalizedUrlPath(urlString) {
  try {
    return normalizeText(new URL(urlString).pathname.replaceAll('/', ' '));
  } catch {
    return '';
  }
}

function hasWholeWord(text, token) {
  if (!text || !token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function parseDeliveryFee(text) {
  const source = String(text || '');

  if (/(?:env(?:í|i)o|delivery)\s+gratis/i.test(source)) {
    return 0;
  }

  const patterns = [
    /env(?:í|i)o\s*(?:desde)?\s*\$\s*([0-9.,]+)/i,
    /delivery\s*(?:desde)?\s*\$\s*([0-9.,]+)/i,
    /\$\s*([0-9.,]+)\s*(?:env(?:í|i)o|delivery)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return textToNumber(match[1]);
    }
  }

  return null;
}

export function isRestaurantDetailPath(pathname) {
  const path = String(pathname || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

  if (!path || path === '/restaurantes' || path === '/restaurant') {
    return false;
  }
  if (!(path.startsWith('/restaurantes/') || path.startsWith('/restaurant/'))) {
    return false;
  }

  const parts = path.split('/').filter(Boolean);
  const last = parts.at(-1);
  if (!last || GENERIC_PATH_SEGMENTS.has(last)) {
    return false;
  }
  return parts.length >= 2;
}

function sanitizeRestaurantName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|·•]+/g, ' ')
    .replace(/^\s*[-:]+\s*/, '')
    .trim();
}

function deriveNameFromRestaurantUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const last = parsed.pathname.split('/').filter(Boolean).at(-1) || '';
    if (!last || GENERIC_PATH_SEGMENTS.has(last.toLowerCase())) {
      return '';
    }
    const slug = last.replace(/^\d+-/, '').replace(/-/g, ' ').trim();
    if (!isLikelyRestaurantName(slug)) {
      return '';
    }
    return slug
      .split(' ')
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  } catch {
    return '';
  }
}
