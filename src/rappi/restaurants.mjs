import { assertRestaurantUrl, assertRestaurantVertical } from './policy.mjs';
import { textToNumber } from './dom-utils.mjs';

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
    const safeUrl = normalizeAndValidateRestaurantUrl(item.href, baseUrl);
    if (!safeUrl || dedup.has(safeUrl)) {
      continue;
    }

    const rating = parseRating(item.textBlob);
    const deliveryFee = parseDeliveryFee(item.textBlob);
    const name = pickRestaurantName(item);

    dedup.set(safeUrl, {
      name,
      url: safeUrl,
      rating,
      deliveryFee,
      snippet: item.textBlob.slice(0, 220)
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

function pickRestaurantName(item) {
  const rawCandidate = String(item.anchorText || '').replace(/\s+/g, ' ').trim();
  if (rawCandidate.length > 2) {
    const fragment = rawCandidate.split(/[|·•]/).map((value) => value.trim()).find(isLikelyRestaurantName);
    if (fragment) {
      return fragment;
    }
    if (isLikelyRestaurantName(rawCandidate)) {
      return rawCandidate;
    }
  }
  const candidate = String(item.textBlob || '')
    .split(/\s{2,}|\||·|•/)
    .map((segment) => segment.trim())
    .find(isLikelyRestaurantName);
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

function normalizeAndValidateRestaurantUrl(href, baseUrl) {
  if (!href) {
    return null;
  }
  try {
    const normalized = new URL(href, baseUrl);
    normalized.hash = '';
    normalized.search = '';
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
  const normalized = normalizeText(candidate);
  const rejectedHints = ['envio', 'delivery', 'calificacion', 'rating', 'pedido minimo', 'desde', '$'];
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
