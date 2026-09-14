#!/usr/bin/env node
// Fails if any autolinked NATIVE module resolves to more than one version.
//
// Why this exists instead of just running `expo-doctor`: doctor's duplicate check
// is all-or-nothing and also flags things that are fine here — most notably the
// two copies of `react` (the app's 19.1.0 and @medplum/react-hooks' 19.2.5),
// which metro.config.js already collapses to a single instance via
// `resolver.resolveRequest`, and same-version copies of a package in two folders,
// which are harmless. Neither can reach the native build.
//
// A native module at two DIFFERENT versions can, and it is invisible everywhere
// else: `tsc` passes, the dev server works, the release build compiles — and the
// app dies on launch. That is exactly what shipped, when `@expo/vector-icons`'
// open-ended `expo-font: ">=14.0.4"` peer range pulled expo-font@57.0.0 into an
// SDK 54 app whose native side linked expo-font@14.0.12.
//
// Usage: node scripts/check-native-dupes.mjs [--platform android|ios]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const platform = process.argv.includes('--platform')
  ? process.argv[process.argv.indexOf('--platform') + 1]
  : 'android';

/** Ask expo's own autolinker which native modules this build would link. */
function resolveNativeModules() {
  const raw = execFileSync(
    'npx',
    ['expo-modules-autolinking', 'search', '--platform', platform, '--json'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  const parsed = JSON.parse(raw);
  return parsed.modules ?? parsed;
}

/** Every on-disk copy of `name`, so we catch a second version the autolinker
 *  did not pick but Metro could still bundle the JS half of. */
function versionsOnDisk(name, roots) {
  const found = new Map();
  for (const root of roots) {
    const pkg = path.join(root, 'node_modules', name, 'package.json');
    try {
      found.set(path.relative(process.cwd(), pkg), JSON.parse(readFileSync(pkg, 'utf8')).version);
    } catch {
      // not installed at this root — expected
    }
  }
  return found;
}

const projectRoot = process.cwd();
const monorepoRoot = path.resolve(projectRoot, '../..');
// The three places a native module can land in this workspace layout.
const roots = [projectRoot, monorepoRoot, path.join(monorepoRoot, 'node_modules', 'expo')];

const modules = resolveNativeModules();
const problems = [];

for (const name of Object.keys(modules)) {
  const copies = versionsOnDisk(name, roots);
  const distinct = new Set(copies.values());
  if (distinct.size > 1) {
    problems.push({ name, copies: [...copies.entries()] });
  }
}

if (problems.length > 0) {
  console.error(`\nNative module version conflict (platform: ${platform}):\n`);
  for (const { name, copies } of problems) {
    console.error(`  ${name}`);
    for (const [where, version] of copies) {
      console.error(`    ${version}  ${where}`);
    }
  }
  console.error(
    '\nA native module at two versions links one version natively and bundles the\n' +
      'other in JS. That is a launch crash on device, not a build error.\n' +
      'Fix by pinning the package in the root package.json "overrides".\n'
  );
  process.exit(1);
}

console.log(`No native module version conflicts (${Object.keys(modules).length} modules, platform: ${platform}).`);
