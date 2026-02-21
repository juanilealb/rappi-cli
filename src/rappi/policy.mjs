const RESTAURANT_PATH_HINTS = ['/restaurantes', '/restaurant'];

export const REAL_PURCHASES_DISABLED = true;

export function assertRestaurantUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  if (!parsed.hostname.endsWith('rappi.com.ar')) {
    throw new Error('Only https://www.rappi.com.ar restaurant URLs are allowed.');
  }

  const lowerPath = parsed.pathname.toLowerCase();
  const isRestaurantPath = RESTAURANT_PATH_HINTS.some((hint) => lowerPath.includes(hint));
  if (!isRestaurantPath) {
    throw new Error('Only restaurant URLs are supported. Supermarket/pharmacy/other verticals are blocked.');
  }

  return parsed.toString();
}

export function assertRestaurantVertical(textBlob) {
  const low = String(textBlob || '').toLowerCase();
  const blockedKeywords = ['supermercado', 'farmacia', 'turbo', 'licores', 'express'];
  for (const keyword of blockedKeywords) {
    if (low.includes(keyword)) {
      throw new Error(`Blocked vertical detected: ${keyword}. This CLI only supports restaurants.`);
    }
  }
}
