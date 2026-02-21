export function textToNumber(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const match = normalized.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export async function collectTextCandidates(scope, selectors) {
  for (const selector of selectors) {
    const el = scope.locator(selector).first();
    if ((await el.count()) > 0) {
      const text = (await el.innerText()).trim();
      if (text) {
        return text;
      }
    }
  }
  return '';
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
