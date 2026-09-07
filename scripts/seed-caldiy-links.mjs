// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Writes the Cal.diy ↔ FHIR links that the website embed and the sync bots rely on:
//
//   Schedule.identifier   https://premierhealth.cm/fhir/sid/caldiy-event-type = <eventTypeId>
//   Schedule.identifier   https://premierhealth.cm/fhir/sid/caldiy-cal-link   = <username>/<slug>
//   Practitioner.identifier https://premierhealth.cm/fhir/sid/caldiy-user     = <calUserId>
//
// Input: scripts/data/caldiy-links.json (see caldiy-links.example.json), one row per
// Schedule keyed by the Schedule's `sid/schedule` identifier that
// seed-cameroon-sites.mjs prints. Idempotent; other identifiers are preserved.
//
// Usage:
//   node scripts/seed-caldiy-links.mjs [--file scripts/data/caldiy-links.json] \
//     [--base http://localhost:8103] [--email ...] [--password ...] [--project <id>]

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const BASE = (args.base ?? process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const EMAIL = args.email ?? 'admin@example.com';
const PASSWORD = args.password ?? 'medplum_admin';
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';
const FILE = args.file ?? join(here, 'data', 'caldiy-links.json');

const PH = 'https://premierhealth.cm/fhir';
const SID = {
  schedule: `${PH}/sid/schedule`,
  eventType: `${PH}/sid/caldiy-event-type`,
  calLink: `${PH}/sid/caldiy-cal-link`,
  user: `${PH}/sid/caldiy-user`,
};

if (!existsSync(FILE)) {
  console.error(`No links file at ${FILE}. Copy scripts/data/caldiy-links.example.json and fill it in.`);
  process.exit(1);
}
const links = JSON.parse(readFileSync(FILE, 'utf8')).filter((row) => row.schedule && !row.schedule.startsWith('00000000-'));

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

const withIdentifier = (identifiers, system, value) => [
  ...(identifiers ?? []).filter((i) => i.system !== system),
  { system, value: String(value) },
];

const token = await login();
console.log(`Writing ${links.length} Cal.diy link(s) into ${BASE} ...`);

for (const row of links) {
  const search = await http('GET', `/fhir/R4/Schedule?identifier=${encodeURIComponent(`${SID.schedule}|${row.schedule}`)}`, undefined, { token });
  const schedule = (search.entry ?? []).map((e) => e.resource)[0];
  if (!schedule) {
    console.log(`  ! no Schedule with ${SID.schedule}|${row.schedule} — run seed-cameroon-sites.mjs first`);
    continue;
  }
  let identifier = schedule.identifier;
  if (row.eventTypeId !== undefined) identifier = withIdentifier(identifier, SID.eventType, row.eventTypeId);
  if (row.calLink) identifier = withIdentifier(identifier, SID.calLink, row.calLink);
  await http('PUT', `/fhir/R4/Schedule/${schedule.id}`, { ...schedule, identifier }, { token });
  console.log(`  = Schedule ${row.schedule}: eventType=${row.eventTypeId ?? '-'} calLink=${row.calLink ?? '-'}`);

  if (row.calUserId !== undefined) {
    const practitionerRef = schedule.actor?.find((a) => a.reference?.startsWith('Practitioner/'))?.reference;
    if (practitionerRef) {
      const practitioner = await http('GET', `/fhir/R4/${practitionerRef}`, undefined, { token });
      await http(
        'PUT',
        `/fhir/R4/${practitionerRef}`,
        { ...practitioner, identifier: withIdentifier(practitioner.identifier, SID.user, row.calUserId) },
        { token }
      );
      console.log(`  = ${practitionerRef}: caldiy-user=${row.calUserId}`);
    }
  }
}
console.log('Cal.diy links written.');
