import path from 'node:path';
import { readText } from '../utils/fs.mjs';

export async function parseOrderLikeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = readText(filePath);

  if (ext === '.json') {
    return JSON.parse(content);
  }

  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(content);
  }

  throw new Error(`Unsupported order file extension: ${ext}. Use .json, .yaml or .yml`);
}

export function parseYaml(input) {
  const normalizedLines = preprocess(input);
  if (normalizedLines.length === 0) {
    return {};
  }

  const state = { index: 0, lines: normalizedLines };
  return parseNode(state, normalizedLines[0].indent);
}

function preprocess(input) {
  return input
    .split(/\r?\n/)
    .map((line) => ({ raw: line, indent: countIndent(line), text: stripComment(line).trim() }))
    .filter((line) => line.text.length > 0);
}

function parseNode(state, indent) {
  const current = state.lines[state.index];
  if (!current || current.indent < indent) {
    return null;
  }

  if (current.text.startsWith('- ')) {
    return parseArray(state, indent);
  }

  return parseObject(state, indent);
}

function parseArray(state, indent) {
  const array = [];

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Invalid YAML indentation near: ${line.raw}`);
    }
    if (!line.text.startsWith('- ')) {
      break;
    }

    const payload = line.text.slice(2).trim();
    state.index += 1;

    if (!payload) {
      array.push(parseNode(state, indent + 2));
      continue;
    }

    if (isKeyValue(payload)) {
      const obj = {};
      const { key, value } = splitKeyValue(payload);
      if (value === null) {
        obj[key] = parseNode(state, indent + 2);
      } else {
        obj[key] = parseScalar(value);
      }

      // Additional key/value lines for this object item.
      while (state.index < state.lines.length) {
        const next = state.lines[state.index];
        if (next.indent < indent + 2) {
          break;
        }
        if (next.indent === indent + 2 && !next.text.startsWith('- ') && isKeyValue(next.text)) {
          const parsed = splitKeyValue(next.text);
          state.index += 1;
          if (parsed.value === null) {
            obj[parsed.key] = parseNode(state, indent + 4);
          } else {
            obj[parsed.key] = parseScalar(parsed.value);
          }
        } else {
          break;
        }
      }

      array.push(obj);
      continue;
    }

    array.push(parseScalar(payload));
  }

  return array;
}

function parseObject(state, indent) {
  const obj = {};

  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent > indent) {
      throw new Error(`Invalid YAML indentation near: ${line.raw}`);
    }
    if (!isKeyValue(line.text)) {
      break;
    }

    const { key, value } = splitKeyValue(line.text);
    state.index += 1;
    if (value === null) {
      obj[key] = parseNode(state, indent + 2);
    } else {
      obj[key] = parseScalar(value);
    }
  }

  return obj;
}

function isKeyValue(text) {
  return /^[^:\-][^:]*:/.test(text);
}

function splitKeyValue(text) {
  const idx = text.indexOf(':');
  if (idx === -1) {
    throw new Error(`Invalid YAML key/value line: ${text}`);
  }
  const key = text.slice(0, idx).trim();
  const rest = text.slice(idx + 1).trim();
  return { key, value: rest === '' ? null : rest };
}

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return trimmed;
}

function countIndent(line) {
  let count = 0;
  for (const char of line) {
    if (char === ' ') {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function stripComment(line) {
  const hash = line.indexOf('#');
  if (hash === -1) {
    return line;
  }
  const quoteCount = (line.slice(0, hash).match(/['"]/g) || []).length;
  if (quoteCount % 2 !== 0) {
    return line;
  }
  return line.slice(0, hash);
}
