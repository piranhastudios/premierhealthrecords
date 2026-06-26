// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Seeds starter care templates (FHIR PlanDefinition). When a clinician picks one
// in the "New encounter" dialog, PlanDefinition/$apply creates a Task per action
// on the encounter. Edit these or add your own visually in the admin app at
// /PlanDefinition/:id/builder. Idempotent (by url).
//
// Usage:
//   node scripts/seed-cameroon-care-templates.mjs \
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
const PHR = 'https://premierhealth.cm/fhir';

const TEMPLATES = [
  {
    id: 'general-consultation',
    title: 'General Consultation',
    actions: [
      ['Record vital signs', 'Measure blood pressure, temperature, pulse, weight'],
      ['Clinical consultation', 'History, examination and assessment'],
      ['Document encounter note', 'Write up findings and plan'],
    ],
  },
  {
    id: 'antenatal-care',
    title: 'Antenatal Care Visit',
    actions: [
      ['Record vital signs & weight', 'BP, temperature, pulse, weight'],
      ['Measure fundal height', 'Symphysio-fundal height and fetal heart rate'],
      ['Urine dipstick test', 'Protein and glucose'],
      ['Malaria & anaemia prophylaxis review', 'IPTp and iron/folate as indicated'],
      ['Document antenatal note', 'Findings, gestational age and plan'],
    ],
  },
  {
    id: 'malaria-management',
    title: 'Malaria Management',
    actions: [
      ['Malaria rapid diagnostic test (RDT)', 'Perform and record result'],
      ['Prescribe antimalarial (ACT)', 'Per national treatment guidelines'],
      ['Patient education & danger signs', 'Adherence and when to return'],
      ['Schedule follow-up', 'Review in 3 days if not improving'],
    ],
  },
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
  const res = await fetch(BASE + path, { method, headers, body: payload });
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
  console.log(`Seeding care templates into ${BASE} ...`);
  const token = await login();

  for (const t of TEMPLATES) {
    const url = `${PHR}/PlanDefinition/${t.id}`;
    const resource = {
      resourceType: 'PlanDefinition',
      url,
      status: 'active',
      title: t.title,
      name: t.title.replace(/[^A-Za-z0-9]/g, ''),
      action: t.actions.map(([title, description]) => ({ title, description })),
    };
    const found = (
      await http('GET', `/fhir/R4/PlanDefinition?url=${encodeURIComponent(url)}`, undefined, { token })
    ).entry?.[0]?.resource;
    if (found) {
      await http('PUT', `/fhir/R4/PlanDefinition/${found.id}`, { ...resource, id: found.id }, { token });
      console.log(`  = ${t.title} (updated)`);
    } else {
      await http('POST', '/fhir/R4/PlanDefinition', resource, { token });
      console.log(`  + ${t.title}`);
    }
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
