#!/usr/bin/env node
import { main } from '../src/cli/main.mjs';

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
