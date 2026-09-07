// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Provisions the read-only ClientApplication the marketing website uses (server
// side, client_credentials) to list sites, doctors and services for the booking
// flow. Creates / updates the AccessPolicy "website-booking policy" and a
// ClientApplication named "Premier Health website" bound to it, then prints the
// env vars to set on Vercel.
//
// Idempotent: re-running prints the existing client id (the secret is only shown
// on creation; pass --rotate to generate a new secret).
//
// Usage:
//   node scripts/seed-website-client.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin] [--project <id>] [--rotate]

import { createHash, randomBytes } from 'node:crypto';

const argv = process.argv.slice(2);
const args = Object.fromEntries(
  argv.reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--') && !arr[i + 1]?.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const ROTATE = argv.includes('--rotate');
const BASE = (args.base ?? process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const EMAIL = args.email ?? 'admin@example.com';
const PASSWORD = args.password ?? 'medplum_admin';
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';

const POLICY_NAME = 'website-booking policy';
const CLIENT_NAME = 'Premier Health website';
// Directory reads (sites, doctors, services) are read-only; booking needs to
// find/create the Patient, read free Slots ($find) and create the busy Slot +
// Appointment ($book runs as the caller), then annotate the Appointment.
const READ_ONLY = ['Location', 'Schedule', 'Practitioner', 'PractitionerRole', 'HealthcareService', 'Organization'];
const WRITABLE = {
  Patient: ['read', 'search', 'create'],
  Slot: ['read', 'search', 'create'],
  Appointment: ['read', 'search', 'create', 'update'],
};

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
  const res = await fetch(BASE + path, { method, headers, body: payload });
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
console.log(`Provisioning the website client on ${BASE} (project ${PROJECT}) ...`);

// 1. Access policy (read-only).
const desiredPolicy = {
  resourceType: 'AccessPolicy',
  name: POLICY_NAME,
  resource: [
    ...READ_ONLY.map((resourceType) => ({ resourceType, readonly: true })),
    ...Object.entries(WRITABLE).map(([resourceType, interaction]) => ({ resourceType, interaction })),
  ],
};
const policySearch = await http('GET', `/fhir/R4/AccessPolicy?name=${encodeURIComponent(POLICY_NAME)}`, undefined, { token });
const existingPolicy = (policySearch.entry ?? []).map((e) => e.resource).find((p) => p.name === POLICY_NAME);
const policy = existingPolicy
  ? await http('PUT', `/fhir/R4/AccessPolicy/${existingPolicy.id}`, { ...desiredPolicy, id: existingPolicy.id }, { token })
  : await http('POST', '/fhir/R4/AccessPolicy', desiredPolicy, { token });
console.log(`  ${existingPolicy ? '=' : '+'} AccessPolicy "${POLICY_NAME}" (${policy.id})`);

// 2. Client application.
const clientSearch = await http('GET', `/fhir/R4/ClientApplication?name=${encodeURIComponent(CLIENT_NAME)}`, undefined, { token });
let client = (clientSearch.entry ?? []).map((e) => e.resource).find((c) => c.name === CLIENT_NAME);
let secret;
if (!client) {
  client = await http(
    'POST',
    `/admin/projects/${PROJECT}/client`,
    { name: CLIENT_NAME, description: 'Server-side read access for the marketing website booking flow', accessPolicy: { reference: `AccessPolicy/${policy.id}` } },
    { token }
  );
  secret = client.secret;
  console.log(`  + ClientApplication "${CLIENT_NAME}" (${client.id})`);
} else {
  console.log(`  = ClientApplication "${CLIENT_NAME}" (${client.id})`);
  if (ROTATE) {
    secret = randomBytes(32).toString('hex');
    client = await http('PUT', `/fhir/R4/ClientApplication/${client.id}`, { ...client, secret }, { token });
    console.log('  + secret rotated');
  }
}

// Make sure the membership carries the policy (covers clients created earlier by hand).
const memberships = await http('GET', `/fhir/R4/ProjectMembership?profile=ClientApplication/${client.id}`, undefined, { token });
const membership = memberships.entry?.[0]?.resource;
if (membership && membership.accessPolicy?.reference !== `AccessPolicy/${policy.id}`) {
  await http('PUT', `/fhir/R4/ProjectMembership/${membership.id}`, { ...membership, accessPolicy: { reference: `AccessPolicy/${policy.id}` } }, { token });
  console.log('  + access policy attached to the client membership');
}

console.log('\nSet these on Vercel (Project → Settings → Environment Variables):');
console.log(`  MEDPLUM_BASE_URL=${BASE}/`);
console.log(`  MEDPLUM_CLIENT_ID=${client.id}`);
console.log(`  MEDPLUM_CLIENT_SECRET=${secret ?? '<unchanged; re-run with --rotate to issue a new one>'}`);
