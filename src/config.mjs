import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const defaultConfigDir = path.join(HOME, '.config', 'rappi-cli');

export function getConfig() {
  const baseUrl = process.env.RAPPI_BASE_URL || 'https://www.rappi.com.ar';
  const sessionFile = process.env.RAPPI_SESSION_FILE || path.join(defaultConfigDir, 'session-state.json');
  const headless = normalizeBoolean(process.env.RAPPI_HEADLESS, false);
  const slowMo = Number(process.env.RAPPI_SLOWMO_MS || 0);
  const defaultCity = process.env.RAPPI_DEFAULT_CITY || 'Buenos Aires';

  return {
    baseUrl,
    sessionFile,
    headless,
    slowMo,
    defaultCity,
    configDir: defaultConfigDir
  };
}

export function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}
