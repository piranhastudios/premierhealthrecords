// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Seeds interoperable, license-free terminology for a Cameroon deployment into a
// Medplum project's terminology server, and the ValueSets the intake form binds to.
//
// Everything uses official code system URIs (ICD-10, CVX, ATC, ISO 3166-2) so the
// data remains standards-based and exchangeable (C-CDA / FHIR referral network).
// We load a curated, Cameroon-relevant subset of each system; expand later by
// importing the full release into the same CodeSystem.
//
// Usage:
//   node scripts/seed-cameroon-terminology.mjs \
//     [--base http://localhost:8103] [--email admin@example.com] [--password medplum_admin]
//
// Requires project-admin or super-admin on the target project.

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

// --- Official code system URIs (kept standard for interoperability) ---
const SYS = {
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  cvx: 'http://hl7.org/fhir/sid/cvx',
  atc: 'http://www.whocc.no/atc',
  iso3166_2: 'urn:iso:std:iso:3166-2',
  // No license-free global standard for allergens/tobacco without SNOMED; small local code systems.
  allergen: `${PHR}/CodeSystem/allergen`,
  tobacco: `${PHR}/CodeSystem/tobacco-use`,
};

// --- Curated, Cameroon-relevant concepts (real standard codes where applicable) ---
const CONCEPTS = {
  [SYS.iso3166_2]: [
    ['CM-AD', 'Adamaoua'], ['CM-CE', 'Centre'], ['CM-ES', 'Est'], ['CM-EN', 'Extrême-Nord'],
    ['CM-LT', 'Littoral'], ['CM-NO', 'Nord'], ['CM-NW', 'Nord-Ouest'], ['CM-OU', 'Ouest'],
    ['CM-SU', 'Sud'], ['CM-SW', 'Sud-Ouest'],
  ],
  [SYS.icd10]: [
    ['B54', 'Unspecified malaria'], ['B50', 'Plasmodium falciparum malaria'],
    ['A01.0', 'Typhoid fever'], ['A09', 'Infectious gastroenteritis and colitis'],
    ['A15', 'Respiratory tuberculosis'], ['B20', 'HIV disease'], ['B05', 'Measles'],
    ['I10', 'Essential (primary) hypertension'], ['I50', 'Heart failure'],
    ['E11', 'Type 2 diabetes mellitus'], ['E66', 'Obesity'], ['D50', 'Iron deficiency anaemia'],
    ['J18', 'Pneumonia, unspecified organism'], ['J45', 'Asthma'], ['J02', 'Acute pharyngitis'],
    ['N39.0', 'Urinary tract infection, site not specified'], ['N18', 'Chronic kidney disease'],
    ['K29', 'Gastritis and duodenitis'], ['H66', 'Suppurative and unspecified otitis media'],
    ['L30', 'Other and unspecified dermatitis'], ['M54', 'Dorsalgia'],
    ['F32', 'Depressive episode'], ['O80', 'Single spontaneous delivery'],
    ['B77', 'Ascariasis'], ['A06', 'Amoebiasis'],
  ],
  [SYS.cvx]: [
    ['19', 'BCG'], ['2', 'Oral polio vaccine (OPV)'], ['10', 'Inactivated polio vaccine (IPV)'],
    ['45', 'Hepatitis B'], ['17', 'Haemophilus influenzae type b (Hib)'],
    ['133', 'Pneumococcal conjugate PCV13'], ['116', 'Rotavirus'], ['05', 'Measles'],
    ['03', 'Measles, mumps, rubella (MMR)'], ['37', 'Yellow fever'], ['09', 'Td (tetanus, diphtheria)'],
    ['35', 'Tetanus toxoid'], ['137', 'HPV, unspecified'], ['213', 'COVID-19, unspecified'],
  ],
  [SYS.atc]: [
    ['N02BE01', 'Paracetamol'], ['M01AE01', 'Ibuprofen'], ['J01CA04', 'Amoxicillin'],
    ['J01CR02', 'Amoxicillin and beta-lactamase inhibitor'], ['J01FA10', 'Azithromycin'],
    ['P01BF01', 'Artemether and lumefantrine'], ['P01BA02', 'Hydroxychloroquine'],
    ['A10BA02', 'Metformin'], ['C08CA01', 'Amlodipine'], ['C09AA05', 'Ramipril'],
    ['C03CA01', 'Furosemide'], ['R03AC02', 'Salbutamol'], ['A02BC01', 'Omeprazole'],
    ['B03AA07', 'Ferrous sulfate'], ['J05AR03', 'Tenofovir disoproxil, emtricitabine and dolutegravir'],
  ],
  [SYS.allergen]: [
    ['penicillin', 'Penicillin'], ['sulfonamide', 'Sulfonamides'], ['aspirin', 'Aspirin'],
    ['nsaid', 'NSAIDs'], ['peanut', 'Peanut'], ['shellfish', 'Shellfish'], ['egg', 'Egg'],
    ['latex', 'Latex'], ['pollen', 'Pollen'], ['dust-mite', 'House dust mite'],
  ],
  [SYS.tobacco]: [
    ['current', 'Current tobacco user'], ['former', 'Former tobacco user'], ['never', 'Never used tobacco'],
  ],
};

// --- ValueSets the intake form binds to (compose from the loaded systems) ---
const VALUE_SETS = [
  ['cameroon-regions', 'Cameroon Regions', SYS.iso3166_2],
  ['cameroon-conditions', 'Cameroon Problem List (ICD-10)', SYS.icd10],
  ['cameroon-immunizations', 'Cameroon Immunizations (CVX)', SYS.cvx],
  ['cameroon-medications', 'Cameroon Medications (ATC)', SYS.atc],
  ['cameroon-allergens', 'Common Allergens', SYS.allergen],
  ['tobacco-use-status', 'Tobacco Use Status', SYS.tobacco],
];

// ---------------------------------------------------------------------------

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
  const { access_token } = await http('POST', '/oauth2/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
  }, { form: true });
  return access_token;
}

async function upsert(token, resourceType, url, build) {
  const search = await http('GET', `/fhir/R4/${resourceType}?url=${encodeURIComponent(url)}`, undefined, { token });
  const existing = search.entry?.[0]?.resource;
  if (existing) return existing;
  return http('POST', `/fhir/R4/${resourceType}`, build(), { token });
}

async function main() {
  console.log(`Seeding Cameroon terminology into ${BASE} ...`);
  const token = await login();
  console.log('Authenticated.');

  for (const [system, concepts] of Object.entries(CONCEPTS)) {
    const local = system.startsWith(PHR);
    await upsert(token, 'CodeSystem', system, () => ({
      resourceType: 'CodeSystem',
      url: system,
      status: 'active',
      content: local ? 'complete' : 'fragment',
      name: system.split('/').pop().replace(/[^A-Za-z0-9]/g, ''),
    }));
    await http('POST', '/fhir/R4/CodeSystem/$import', {
      resourceType: 'Parameters',
      parameter: [
        { name: 'system', valueUri: system },
        ...concepts.map(([code, display]) => ({ name: 'concept', valueCoding: { system, code, display } })),
      ],
    }, { token });
    console.log(`  CodeSystem ${system}: imported ${concepts.length} concepts`);
  }

  for (const [id, name, system] of VALUE_SETS) {
    const url = `${PHR}/ValueSet/${id}`;
    await upsert(token, 'ValueSet', url, () => ({
      resourceType: 'ValueSet',
      url,
      status: 'active',
      name: name.replace(/[^A-Za-z0-9]/g, ''),
      title: name,
      compose: { include: [{ system }] },
    }));
    const expanded = await http(
      'GET',
      `/fhir/R4/ValueSet/$expand?url=${encodeURIComponent(url)}&count=200`,
      undefined,
      { token }
    );
    console.log(`  ValueSet ${id}: $expand -> ${expanded.expansion?.total ?? expanded.expansion?.contains?.length ?? 0} codes`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
