import fs from 'node:fs';
import path from 'node:path';

export function ensureDirSecure(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Windows and some filesystems may ignore chmod.
  }
}

export function writeJsonSecure(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDirSecure(dir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort permissions hardening.
  }
}

export function writeJsonSecureAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDirSecure(dir);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // Best effort permissions hardening.
    }
    fs.renameSync(tmpPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort permissions hardening.
    }
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function exists(filePath) {
  return fs.existsSync(filePath);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function writeText(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}
