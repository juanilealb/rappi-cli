#!/usr/bin/env node
import { loadDotEnv } from '../utils/env.mjs';
import { parseArgs } from './args.mjs';
import { runCommand } from './commands.mjs';
import { printHelp } from './help.mjs';

export async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  const { positionals, options } = parseArgs(argv);

  if (positionals.length === 0 || options.help) {
    printHelp();
    return;
  }

  await runCommand(positionals, options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
