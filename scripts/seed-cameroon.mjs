// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Runs all Premier Health reference-data seeds in order (terminology, insurers,
// care templates). Idempotent — safe to run on every deploy. Forwards all CLI
// args (e.g. --base / --email / --password) to each seed.
//
// Usage:
//   node scripts/seed-cameroon.mjs [--base http://localhost:8103] [--email ...] [--password ...]

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const seeds = ['seed-cameroon-terminology.mjs', 'seed-cameroon-insurers.mjs', 'seed-cameroon-care-templates.mjs'];

for (const seed of seeds) {
  console.log(`\n=== ${seed} ===`);
  const result = spawnSync(process.execPath, [join(here, seed), ...args], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Seed failed: ${seed}`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nAll seeds complete.');
