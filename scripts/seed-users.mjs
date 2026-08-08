// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Provisions the scoped staff logins used on live so a local dev server matches:
//   frontdesk@example.com / medplum_user  -> "Front Desk / Receptionist" AccessPolicy
//   nurse@example.com     / medplum_user  -> "Nurse / Clinical" AccessPolicy
//
// Both users are created in the default "FHIR R4" project — the clinic DATA project,
// where the staff, the patients, the custom conformance resources, and the bots all
// live. The super-admin project is only the operator console. This script also gives
// the admin an admin membership in FHIR R4 (so the other seeds can log in scoped to
// it) and turns on the project's strict mode (so profile constraints reject writes).
// See examples/medplum-demo-bots/src/premierhealth/config/apply-access-policy.md.
//
// Idempotent: safe to run on every dev start. AccessPolicies are upserted by name
// (scoped to the FHIR R4 project); memberships are upserted via the invite endpoint's
// `upsert` flag.
//
// Usage:
//   node scripts/seed-users.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin]

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configDir = join(here, '..', 'examples', 'medplum-demo-bots', 'src', 'premierhealth', 'config');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const BASE = (args.base ?? process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const EMAIL = args.email ?? 'admin@example.com';
const PASSWORD = args.password ?? 'medplum_admin';

// Fixed id of the default "FHIR R4" project (server seed: packages/server/src/constants.ts).
const R4_PROJECT_ID = '161452d9-43b7-5c29-aa7b-c85680fa45c6';
const STAFF_PASSWORD = 'medplum_user';

// DEV-ONLY QR signing key. The Patient/$issue-qr and $verify-qr operations HMAC over this
// project secret (patients issue, staff scan — both in FHIR R4, so the key lives on this project).
// In production DO NOT use this value: set a strong random QR_SIGNING_KEY as a Coolify/Docker env
// var (server-wide) or as a secret on the prod FHIR R4 project.
const QR_SIGNING_KEY_DEV = '5f9d3c7a1e0b46829d5a7c1f3e8b0a2c4d6e8f101214161820222426282a2c2e';

const STAFF = [
  { firstName: 'Front', lastName: 'Desk', email: 'frontdesk@example.com', policyFile: 'front-desk-access-policy.json' },
  { firstName: 'Nurse', lastName: 'User', email: 'nurse@example.com', policyFile: 'nurse-access-policy.json' },
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}

// Login as the (super) admin. Once the admin also holds the FHIR R4 data-project
// membership (created below), an unscoped login returns a membership choice —
// pick the one that is NOT the R4 data project, i.e. the super-admin console.
async function login() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const res = await http('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });
  let code = res.code;
  if (!code && res.memberships) {
    const membership =
      res.memberships.find((m) => m.project?.reference !== `Project/${R4_PROJECT_ID}`) ?? res.memberships[0];
    ({ code } = await http('POST', '/auth/profile', { login: res.login, profile: membership.id }));
  }
  const { access_token } = await http(
    'POST',
    '/oauth2/token',
    { grant_type: 'authorization_code', code, code_verifier: verifier },
    { form: true }
  );
  return access_token;
}

// Create or update an AccessPolicy inside the FHIR R4 project. Super admins may set
// meta.project on write, so the policy lands next to the memberships that reference it.
async function upsertAccessPolicy(token, policyFile) {
  const policy = JSON.parse(readFileSync(join(configDir, policyFile), 'utf8'));
  const search = await http('GET', `/fhir/R4/AccessPolicy?name=${encodeURIComponent(policy.name)}`, undefined, {
    token,
  });
  const existing = (search.entry ?? [])
    .map((e) => e.resource)
    .find((r) => !r.meta?.project || r.meta.project === R4_PROJECT_ID);

  const resource = { ...policy, meta: { ...policy.meta, project: R4_PROJECT_ID } };
  if (existing) {
    const updated = await http(
      'PUT',
      `/fhir/R4/AccessPolicy/${existing.id}`,
      { ...resource, id: existing.id },
      { token }
    );
    console.log(`  = AccessPolicy "${policy.name}" (updated)`);
    return updated;
  }
  const created = await http('POST', '/fhir/R4/AccessPolicy', resource, { token });
  console.log(`  + AccessPolicy "${policy.name}" (created)`);
  return created;
}

// Invite (or update, via upsert) a staff user into the FHIR R4 project with the policy.
async function ensureStaffUser(token, { firstName, lastName, email }, accessPolicyId) {
  const membership = await http(
    'POST',
    `/admin/projects/${R4_PROJECT_ID}/invite`,
    {
      resourceType: 'Practitioner',
      firstName,
      lastName,
      email,
      password: STAFF_PASSWORD,
      sendEmail: false,
      upsert: true,
      accessPolicy: { reference: `AccessPolicy/${accessPolicyId}` },
    },
    { token }
  );
  console.log(`  * ${email} -> ${membership.accessPolicy?.reference ?? '(no policy)'} (password: ${STAFF_PASSWORD})`);
  return membership;
}

// Profile validation (mandatory phone, no deceased field, …) only rejects writes
// when the project is in strict mode — otherwise violations merely log a server
// warning. The stock "FHIR R4" project is seeded non-strict.
async function ensureStrictMode(token) {
  const project = await http('GET', `/fhir/R4/Project/${R4_PROJECT_ID}`, undefined, { token });
  if (project.strictMode === true) {
    console.log('  = strictMode already enabled');
    return;
  }
  await http('PUT', `/fhir/R4/Project/${R4_PROJECT_ID}`, { ...project, strictMode: true }, { token });
  console.log('  + strictMode enabled (profile constraints now reject invalid writes)');
}

// Provision the dev QR signing key on the FHIR R4 project (idempotent). Required by the
// Patient/$issue-qr and $verify-qr operations (dashboard QR scanner + portal QR).
async function ensureQrSigningKey(token) {
  const project = await http('GET', `/fhir/R4/Project/${R4_PROJECT_ID}`, undefined, { token });
  if (project.secret?.some((s) => s.name === 'QR_SIGNING_KEY')) {
    console.log('  = QR_SIGNING_KEY already set');
    return;
  }
  const secret = [...(project.secret ?? []), { name: 'QR_SIGNING_KEY', valueString: QR_SIGNING_KEY_DEV }];
  await http('PUT', `/fhir/R4/Project/${R4_PROJECT_ID}`, { ...project, secret }, { token });
  console.log('  + QR_SIGNING_KEY set (dev key)');
}

// The admin also gets an ADMIN membership in the FHIR R4 data project, so the
// other seeds (profiles, terminology, insurers, care templates, bots) can log in
// scoped to that project and install the custom resources where the staff and
// patients actually live.
async function ensureAdminMembership(token) {
  const membership = await http(
    'POST',
    `/admin/projects/${R4_PROJECT_ID}/invite`,
    {
      resourceType: 'Practitioner',
      firstName: 'Project',
      lastName: 'Admin',
      email: EMAIL,
      sendEmail: false,
      upsert: true,
      admin: true,
    },
    { token }
  );
  console.log(`  * ${EMAIL} -> admin membership in FHIR R4 (${membership.id})`);
}

async function main() {
  console.log(`Seeding staff users into ${BASE} (project ${R4_PROJECT_ID}) ...`);
  const token = await login();

  for (const staff of STAFF) {
    const policy = await upsertAccessPolicy(token, staff.policyFile);
    await ensureStaffUser(token, staff, policy.id);
  }

  await ensureAdminMembership(token);
  await ensureStrictMode(token);
  await ensureQrSigningKey(token);

  console.log('Done. Log in at the provider app as frontdesk@example.com / nurse@example.com (password medplum_user).');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
