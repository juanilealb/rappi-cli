export function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    if (!withoutPrefix) {
      continue;
    }

    if (withoutPrefix.startsWith('no-')) {
      options[withoutPrefix.slice(3)] = false;
      continue;
    }

    const equalIndex = withoutPrefix.indexOf('=');
    if (equalIndex !== -1) {
      const key = withoutPrefix.slice(0, equalIndex);
      const rawValue = withoutPrefix.slice(equalIndex + 1);
      options[key] = coerce(rawValue);
      continue;
    }

    const key = withoutPrefix;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      options[key] = coerce(next);
      i += 1;
    } else {
      options[key] = true;
    }
  }

  return { positionals, options };
}

function coerce(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}
