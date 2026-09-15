#!/usr/bin/env node
// Fails if a build profile's SENTRY_ORG/SENTRY_PROJECT do not resolve.
//
// This exists because the Sentry Gradle task shells out to sentry-cli and takes
// the whole Android build down when the project slug is wrong:
//
//   error: API request failed
//       sentry reported an error: One or more projects are invalid (http status: 400)
//
// That surfaces ~7 minutes into Gradle. Renaming a project in the Sentry UI
// changes its slug while the DSN (which encodes the numeric project id) keeps
// working, so nothing else tells you the build is now broken.
//
// Usage: node scripts/check-sentry-project.mjs [--profile preview]
import { readFileSync } from 'node:fs';

const argv = process.argv;
const profile = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'preview';

const easJson = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const env = easJson.build?.[profile]?.env ?? {};
const { SENTRY_ORG: org, SENTRY_PROJECT: project, PHC_SENTRY_DSN: dsn } = env;

if (!dsn) {
  console.log(`Sentry not configured for "${profile}" — nothing to check.`);
  process.exit(0);
}
if (!org || !project) {
  console.error(`\n  PHC_SENTRY_DSN is set for "${profile}" but SENTRY_ORG/SENTRY_PROJECT are not.`);
  console.error('  The Gradle upload task will fail with "An organization ID or slug is required".\n');
  process.exit(1);
}

const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) {
  // On CI the token lives as an EAS environment variable, so it is legitimately
  // absent locally. Check what can be checked without it and say so.
  console.log(`Sentry: ${org}/${project} (no SENTRY_AUTH_TOKEN here — slug not verified against the API).`);
  process.exit(0);
}

// The DSN's path segment is the numeric project id. It survives a rename, which
// is exactly why a stale slug goes unnoticed.
const dsnProjectId = dsn.split('/').pop();
// Region matters: this org is EU-hosted, and the token carries its own region.
const host = /ingest\.de\.sentry\.io/.test(dsn) ? 'de.sentry.io' : 'sentry.io';
const url = `https://${host}/api/0/projects/${org}/${project}/releases/`;

process.stdout.write(`Checking ${profile} -> ${org}/${project} (project id ${dsnProjectId})\n`);

let response;
try {
  response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
} catch (err) {
  console.error(`\n  Could not reach Sentry: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// A renamed or missing project redirects rather than 404s.
if (response.status !== 200) {
  console.error(`\n  Sentry says ${org}/${project} is not a project (HTTP ${response.status}).`);
  console.error('  It was most likely renamed: the slug changes but the DSN keeps working,');
  console.error('  so only the source-map upload breaks — 7 minutes into the Gradle build.');
  console.error(`  Fix SENTRY_PROJECT in eas.json to match the slug in Sentry -> Settings.\n`);
  process.exit(1);
}

console.log(`  OK — ${org}/${project} resolves.`);
