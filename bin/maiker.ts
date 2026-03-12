#!/usr/bin/env node
/**
 * mAIker CLI — Entry point
 *
 * Development:   npx tsx bin/maiker.ts <command>
 * Production:    node dist/bin/maiker.js <command>
 * Linked:        maiker <command>
 */

import { runCLI } from '../src/cli/index.js';

runCLI(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
