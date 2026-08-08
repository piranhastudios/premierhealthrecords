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
// Install into the FHIR R4 data project (where staff and patients live) by
// default — the fixed id every Medplum server seeds (packages/server/src/constants.ts).
// The admin's membership there is created by scripts/seed-users.mjs.
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';
const PHR = 'https://premierhealth.cm/fhir';

// ---------------------------------------------------------------------------
// Service price list (ChargeItemDefinitions, XAF). PLACEHOLDER amounts — edit
// here or in the admin app; the QuickBooks pricing pull maintains its own
// catalog and does not overwrite these.
// The provider's charge capture (utils/encounter.ts) requires a CPT-system
// coding on the billed code plus an `applicable-charge-definition` canonical —
// the CPT codes below are pragmatic mappings for that machinery.
// ---------------------------------------------------------------------------
const CPT = 'http://www.ama-assn.org/go/cpt';
const CHARGE_DEF_EXT = 'http://medplum.com/fhir/StructureDefinition/applicable-charge-definition';
const BILLING_CODE_EXT = 'http://hl7.org/fhir/uv/order-catalog/StructureDefinition/ServiceBillingCode';

const PRICES = [
  { id: 'consultation-general', title: 'General consultation', xaf: 10000 },
  { id: 'consultation-antenatal', title: 'Antenatal care visit', xaf: 8000 },
  { id: 'lab-malaria-rdt', title: 'Malaria rapid diagnostic test (RDT)', xaf: 2000 },
  { id: 'lab-urine-dipstick', title: 'Urine dipstick (protein/glucose)', xaf: 1500 },
];

const priceUrl = (id) => `${PHR}/ChargeItemDefinition/${id}`;

// Billable investigations: ActivityDefinitions of kind ServiceRequest. On
// PlanDefinition/$apply the server copies `code` and `extension` onto the
// created ServiceRequest, which is exactly what the provider's pay-gate reads
// (CPT coding + applicable-charge-definition => ChargeItem + task on hold
// awaiting payment).
const ACTIVITIES = [
  {
    id: 'malaria-rdt',
    title: 'Malaria rapid diagnostic test (RDT)',
    cpt: '87899',
    price: 'lab-malaria-rdt',
  },
  {
    id: 'urine-dipstick',
    title: 'Urine dipstick (protein/glucose)',
    cpt: '81002',
    price: 'lab-urine-dipstick',
  },
];

const activityUrl = (id) => `${PHR}/ActivityDefinition/${id}`;

// Visit-level billing: the consultation fee charged for the visit itself
// (raised at encounter creation; collected at checkout together with any
// investigation charges).
const consultBilling = (cpt, display, priceId) => ({
  extension: [
    {
      url: BILLING_CODE_EXT,
      valueCodeableConcept: { coding: [{ system: CPT, code: cpt, display }], text: display },
    },
    { url: CHARGE_DEF_EXT, valueCanonical: priceUrl(priceId) },
  ],
});

const TEMPLATES = [
  {
    id: 'general-consultation',
    title: 'General Consultation',
    billing: consultBilling('99203', 'Office consultation, new patient', 'consultation-general'),
    actions: [
      ['Record vital signs', 'Measure blood pressure, temperature, pulse, weight'],
      ['Clinical consultation', 'History, examination and assessment'],
      ['Document encounter note', 'Write up findings and plan'],
    ],
  },
  {
    id: 'antenatal-care',
    title: 'Antenatal Care Visit',
    billing: consultBilling('59425', 'Antepartum care visit', 'consultation-antenatal'),
    actions: [
      ['Record vital signs & weight', 'BP, temperature, pulse, weight'],
      ['Measure fundal height', 'Symphysio-fundal height and fetal heart rate'],
      ['Urine dipstick test', 'Protein and glucose', 'urine-dipstick'],
      ['Malaria & anaemia prophylaxis review', 'IPTp and iron/folate as indicated'],
      ['Document antenatal note', 'Findings, gestational age and plan'],
    ],
  },
  {
    id: 'malaria-management',
    title: 'Malaria Management',
    billing: consultBilling('99203', 'Office consultation, new patient', 'consultation-general'),
    actions: [
      ['Malaria rapid diagnostic test (RDT)', 'Perform and record result', 'malaria-rdt'],
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
  console.log(`Seeding care templates into ${BASE} ...`);
  const token = await login();

  // Upsert-by-url helper shared by all three resource types.
  async function upsert(resourceType, url, resource) {
    const found = (await http('GET', `/fhir/R4/${resourceType}?url=${encodeURIComponent(url)}`, undefined, { token }))
      .entry?.[0]?.resource;
    if (found) {
      await http('PUT', `/fhir/R4/${resourceType}/${found.id}`, { ...resource, id: found.id }, { token });
      return '=';
    }
    await http('POST', `/fhir/R4/${resourceType}`, resource, { token });
    return '+';
  }

  for (const p of PRICES) {
    const url = priceUrl(p.id);
    const mark = await upsert('ChargeItemDefinition', url, {
      resourceType: 'ChargeItemDefinition',
      url,
      status: 'active',
      title: p.title,
      propertyGroup: [{ priceComponent: [{ type: 'base', amount: { value: p.xaf, currency: 'XAF' } }] }],
    });
    console.log(`  ${mark} price: ${p.title} — ${p.xaf.toLocaleString()} XAF`);
  }

  for (const a of ACTIVITIES) {
    const url = activityUrl(a.id);
    const mark = await upsert('ActivityDefinition', url, {
      resourceType: 'ActivityDefinition',
      url,
      status: 'active',
      name: a.id.replace(/[^A-Za-z0-9]/g, ''),
      title: a.title,
      kind: 'ServiceRequest',
      intent: 'order',
      code: { coding: [{ system: CPT, code: a.cpt, display: a.title }], text: a.title },
      extension: [{ url: CHARGE_DEF_EXT, valueCanonical: priceUrl(a.price) }],
    });
    console.log(`  ${mark} activity: ${a.title}`);
  }

  for (const t of TEMPLATES) {
    const url = `${PHR}/PlanDefinition/${t.id}`;
    const resource = {
      resourceType: 'PlanDefinition',
      url,
      status: 'active',
      title: t.title,
      name: t.title.replace(/[^A-Za-z0-9]/g, ''),
      ...(t.billing ?? {}),
      action: t.actions.map(([title, description, activityId]) => ({
        title,
        description,
        ...(activityId ? { definitionCanonical: activityUrl(activityId) } : {}),
      })),
    };
    const mark = await upsert('PlanDefinition', url, resource);
    console.log(`  ${mark} ${t.title}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
