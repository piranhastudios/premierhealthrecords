// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Seeds the insurance payers Premier Health works with as FHIR Organization
// resources (type "ins"), so they can be selected at checkout (Coverage.payor)
// and in the patient intake form. Idempotent.
//
// Usage:
//   node scripts/seed-cameroon-insurers.mjs \
//     [--base http://localhost:8103] [--email admin@example.com] [--password medplum_admin]

import { createHash, randomBytes } from 'node:crypto';

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

const INSURER_SYSTEM = 'https://premierhealth.cm/fhir/insurer';
const INSURERS = [
  ['axa', 'AXA Assurances Cameroun'],
  ['pass24', 'PASS24 Mobile'],
  ['saar', 'SAAR Assurances'],
  ['sanlam', 'Sanlam Assurances'],
  ['wtw', 'WTW (Willis Towers Watson)'],
  ['zenithe', 'Zenithe Insurance'],
];

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
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

async function main() {
  console.log(`Seeding insurers into ${BASE} ...`);
  const token = await login();

  for (const [code, name] of INSURERS) {
    const search = await http(
      'GET',
      `/fhir/R4/Organization?identifier=${encodeURIComponent(`${INSURER_SYSTEM}|${code}`)}`,
      undefined,
      { token }
    );
    if (search.entry?.[0]) {
      console.log(`  = ${name} (exists)`);
      continue;
    }
    await http(
      'POST',
      '/fhir/R4/Organization',
      {
        resourceType: 'Organization',
        active: true,
        identifier: [{ system: INSURER_SYSTEM, value: code }],
        type: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/organization-type',
                code: 'ins',
                display: 'Insurance Company',
              },
            ],
          },
        ],
        name,
      },
      { token }
    );
    console.log(`  + ${name}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
