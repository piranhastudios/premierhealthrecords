#!/usr/bin/env node
// Fails if the Medplum base URL a build profile points at does not answer.
//
// This exists because the live Android app shipped pointed at
// https://api.premierhealth.cm/ — a hostname with no DNS record at all — and
// nothing noticed until users did. A base URL is baked into the binary at build
// time, so getting it wrong means a reinstall, not a config change.
//
// Checks `{baseUrl}healthcheck`, which Medplum serves unauthenticated.
//
// Usage: node scripts/check-api-reachable.mjs [--profile production]
import { readFileSync } from 'node:fs';

const argv = process.argv;
const profile = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'production';

const easJson = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const baseUrl = easJson.build?.[profile]?.env?.MEDPLUM_BASE_URL;

if (!baseUrl) {
  console.error(`No build.${profile}.env.MEDPLUM_BASE_URL in eas.json.`);
  process.exit(1);
}

const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}healthcheck`;
process.stdout.write(`Checking ${profile} -> ${url}\n`);

let response;
try {
  response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
} catch (err) {
  // DNS failure, TLS failure and connection refused all land here. A TLS error
  // matters as much as a 404: Android rejects an untrusted certificate outright,
  // so every request from the app fails.
  console.error(`\n  UNREACHABLE: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`\n  ${baseUrl} cannot be reached. A build made now would ship unable`);
  console.error('  to talk to its server. Fix the host, or point this profile elsewhere.\n');
  process.exit(1);
}

const body = await response.text();
let ok = false;
try {
  ok = JSON.parse(body).ok === true;
} catch {
  // not JSON — fall through to the error below
}

if (!response.ok || !ok) {
  console.error(`\n  BAD RESPONSE: HTTP ${response.status} (${response.headers.get('content-type') ?? 'no content-type'})`);
  console.error(`  ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  console.error(`\n  ${url} did not return a Medplum healthcheck. The host resolves but`);
  console.error('  is not serving the API — check which container the domain routes to.\n');
  process.exit(1);
}

console.log(`  OK — ${JSON.parse(body).version ?? 'medplum'}`);
