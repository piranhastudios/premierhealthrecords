// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Uploads the Premier Health StructureDefinition profiles (currently the patient
// registration profile). Without the profile installed, /Patient/new silently falls
// back to the base FHIR form and drops the mandatory-phone and no-deceased-field
// constraints.
//
// Idempotent: conditional update by canonical URL.
//
// Usage:
//   node scripts/seed-profiles.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin]

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PROFILES = [join(here, '..', 'examples', 'medplum-provider', 'data', 'premier-health-patient.json')];

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const BASE = (args.base ?? process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const EMAIL = args.email ?? 'admin@example.com';
const PASSWORD = args.password ?? 'medplum_admin';
// Install into the FHIR R4 data project (where staff and patients live) by
// default — the fixed id every Medplum server seeds (packages/server/src/constants.ts).
// The admin's membership there is created by scripts/seed-users.mjs.
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';

async function http(method, path, body, { token, form } = {}) {
  const headers = {};
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  } else if (body) {
    headers['Content-Type'] = path.startsWith('/fhir') ? 'application/fhir+json' : 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res = await fetch(BASE + path, { method, headers, body: payload });
  // The auth endpoints are rate-limited (5/min); the seed chain logs in several
  // times back to back, so wait out a 429 instead of failing the whole seed.
  for (let retry = 0; res.status === 429 && retry < 3; retry++) {
    const detail = await res.text();
    const wait = Math.min(65000, (Number(/_msBeforeNext\\?":(\d+)/.exec(detail)?.[1]) || 30000) + 1000);
    console.log(`  … rate limited on ${path}, retrying in ${Math.round(wait / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await fetch(BASE + path, { method, headers, body: payload });
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}

async function login() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const { code } = await http('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    // Scoped login: resources are created in this project.
    projectId: PROJECT,
  });
  const { access_token } = await http(
    'POST',
    '/oauth2/token',
    { grant_type: 'authorization_code', code, code_verifier: verifier },
    { form: true }
  );
  return access_token;
}

const token = await login();
console.log(`Uploading profiles to ${BASE} ...`);

for (const file of PROFILES) {
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  const search = await http('GET', `/fhir/R4/StructureDefinition?url=${encodeURIComponent(profile.url)}`, undefined, {
    token,
  });
  const existing = (search.entry ?? []).map((e) => e.resource)[0];
  if (existing) {
    await http('PUT', `/fhir/R4/StructureDefinition/${existing.id}`, { ...profile, id: existing.id }, { token });
    console.log(`  = ${profile.url} (updated)`);
  } else {
    await http('POST', '/fhir/R4/StructureDefinition', profile, { token });
    console.log(`  + ${profile.url} (created)`);
  }
}
console.log('Profiles uploaded.');
