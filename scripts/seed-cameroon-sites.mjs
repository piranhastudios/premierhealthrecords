// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Seeds the multi-site scheduling backbone for Premier Health Centres:
//
//   Organization (Premier Health)
//     └─ Location per site            (identifier: https://premierhealth.cm/fhir/sid/site)
//          └─ HealthcareService per (site × service line)
//                                     (identifier: .../sid/healthcare-service = "<site>-<service>")
//   Practitioner  ← timezone extension (Africa/Douala) so Schedule/$find and $book work
//     └─ PractitionerRole per (practitioner × site)   (.../sid/practitioner-role)
//     └─ Schedule per (practitioner × site)            (.../sid/schedule = "<practitionerId>-<site>")
//          actor: [Practitioner, Location]; serviceType → every HealthcareService at the site.
//
// Availability rules live on the HealthcareService (SchedulingParameters + availableTime =
// the site's opening hours). Staff can override per practitioner by adding Schedule-level
// SchedulingParameters in the provider app; this seed never touches Schedule extensions
// once a Schedule exists, and never removes serviceType entries staff have toggled.
//
// Idempotent — safe to run on every deploy. Organization / Location / HealthcareService
// are seed-managed (re-runs overwrite them from SITES / SERVICE_LINES below).
//
// Usage:
//   node scripts/seed-cameroon-sites.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin] [--project <id>]

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
// FHIR R4 data project (fixed id, see packages/server/src/constants.ts).
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';
// Sites and services only: no PractitionerRoles, no Schedules, no timezone stamps.
const SKIP_SCHEDULES = process.argv.includes('--skip-schedules');

// ---------------------------------------------------------------------------
// Reference data. Add a site = add one entry to SITES.
// ---------------------------------------------------------------------------

const PH = 'https://premierhealth.cm/fhir';
const SID = {
  organization: `${PH}/sid/organization`,
  site: `${PH}/sid/site`,
  healthcareService: `${PH}/sid/healthcare-service`,
  practitioner: `${PH}/sid/practitioner`,
  practitionerRole: `${PH}/sid/practitioner-role`,
  schedule: `${PH}/sid/schedule`,
};
const SERVICE_LINE_SYSTEM = `${PH}/CodeSystem/service-line`;
const TIMEZONE_EXT = 'http://hl7.org/fhir/StructureDefinition/timezone';
const SCHEDULING_PARAMETERS_EXT = 'https://medplum.com/fhir/StructureDefinition/SchedulingParameters';
const SERVICE_TYPE_REFERENCE_EXT = 'https://medplum.com/fhir/service-type-reference';
const TIMEZONE = 'Africa/Douala';
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const ORGANIZATION = {
  slug: 'premier-health',
  name: 'Premier Health Centres Cameroon',
};

const SITES = [
  {
    slug: 'douala-grand-mall',
    name: 'Premier Health Centre – Douala Grand Mall',
    nameFr: 'Centre Premier Health – Douala Grand Mall',
    description: 'Our opening site, inside Douala Grand Mall.',
    address: { line: ['Douala Grand Mall'], city: 'Douala', country: 'CM' },
    // hoursOfOperation / HealthcareService.availableTime
    hours: [{ daysOfWeek: ALL_DAYS, start: '09:00:00', end: '19:00:00' }],
    timezone: TIMEZONE,
  },
];

// Service lines offered at every site. `duration` is the default appointment length
// used by $find/$book; `alignment` is the slot grid (minutes).
const SERVICE_LINES = [
  { code: 'general-consultation', display: 'General consultation', displayFr: 'Consultation générale', duration: 30 },
  { code: 'follow-up', display: 'Follow-up visit', displayFr: 'Visite de suivi', duration: 15 },
  { code: 'pediatrics', display: 'Paediatrics', displayFr: 'Pédiatrie', duration: 30 },
  { code: 'ecg', display: 'ECG & cardiology', displayFr: 'ECG et cardiologie', duration: 30 },
  { code: 'laboratory', display: 'Laboratory', displayFr: 'Laboratoire', duration: 15 },
  { code: 'telehealth', display: 'Video consultation', displayFr: 'Consultation vidéo', duration: 30 },
];
const ALIGNMENT_MINUTES = 15;

// The clinicians patients can book, and what each of them offers. This list is the
// source of truth: each entry is upserted as a Practitioner (identifier
// `.../sid/practitioner`) and given a PractitionerRole + Schedule per site. Nobody
// else gets a bookable diary, so front-desk and management accounts never show up
// as doctors on the website.
//
// These are records, not logins. Invite a clinician in the admin app (or via
// scripts/seed-users.mjs) when they need to sign in; matching is by identifier, so
// an invite later attaches to the same person.
//
// `services` are SERVICE_LINES codes. A service nobody offers simply does not
// appear on the website until someone is given it.
//
// Pass --skip-schedules to seed the sites and services only.
const GENERAL = ['general-consultation', 'follow-up', 'telehealth'];
const CLINICIANS = [
  // `specialty` is patient-facing: it is the FIRST thing someone picks when booking,
  // so it must be the field of medicine ("Cardiology"), not the job title.
  // `role` is the job title, stored separately on PractitionerRole.code.
  { slug: 'theodore-ngatchu', prefix: 'Prof', given: ['Theodore'], family: 'Ngatchu', specialty: 'General practice', role: 'Managing Director', services: GENERAL },
  { slug: 'adeline-affong', prefix: 'Dr', given: ['Adeline'], family: 'Afong', specialty: 'General practice', role: 'Clinical Director', services: GENERAL },
  { slug: 'paul-andang', prefix: 'Dr', given: ['Paul'], family: 'Andang', specialty: 'General practice', role: 'General Physician', services: GENERAL },
  { slug: 'morike-mokube', prefix: 'Dr', given: ['Morike'], family: 'Mokube', specialty: 'Cardiology', role: 'Consultant Cardiologist', services: [...GENERAL, 'ecg'] },
  { slug: 'aloysius-mbako', prefix: 'Dr', given: ['Aloysius'], family: 'Mbako', specialty: 'Orthopaedics', role: 'Consultant Orthopaedics', services: GENERAL },
  { slug: 'dyanda-stephanie', prefix: 'Ms', given: ['Dyanda'], family: 'Stephanie', specialty: 'Endocrinology', role: 'Endocrinologist', services: GENERAL },
].map((c) => ({ ...c, sites: c.sites ?? ['douala-grand-mall'] }));

// ---------------------------------------------------------------------------
// HTTP + auth (same shape as the other seeds)
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
  let res = await fetch(BASE + path, { method, headers, body: payload });
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
const fhir = {
  search: async (type, params) => {
    const bundle = await http('GET', `/fhir/R4/${type}?${new URLSearchParams(params)}`, undefined, { token });
    return (bundle.entry ?? []).map((e) => e.resource);
  },
  create: (resource) => http('POST', `/fhir/R4/${resource.resourceType}`, resource, { token }),
  update: (resource) => http('PUT', `/fhir/R4/${resource.resourceType}/${resource.id}`, resource, { token }),
};

const ref = (resource) => ({ reference: `${resource.resourceType}/${resource.id}`, display: resource.name });
const identifier = (system, value) => ({ system, value });

/** Merge our identifier into the resource's identifiers without dropping others (e.g. Cal.diy links). */
function withIdentifier(existing, system, value) {
  const others = (existing?.identifier ?? []).filter((i) => i.system !== system);
  return [...others, identifier(system, value)];
}

/**
 * Seed-managed upsert: the resource is rebuilt from the definition below on every
 * run (only the id and foreign identifiers survive).
 */
async function upsertManaged(system, value, build) {
  const [existing] = await fhir.search(build.resourceType, { identifier: `${system}|${value}`, _count: '1' });
  const resource = { ...build, identifier: withIdentifier(existing, system, value) };
  if (existing) {
    const updated = await fhir.update({ ...resource, id: existing.id });
    console.log(`  = ${build.resourceType} ${value} (updated)`);
    return updated;
  }
  const created = await fhir.create(resource);
  console.log(`  + ${build.resourceType} ${value} (created)`);
  return created;
}

const availableTime = (site) =>
  site.hours.map((h) => ({ daysOfWeek: h.daysOfWeek, availableStartTime: h.start, availableEndTime: h.end }));

// ---------------------------------------------------------------------------
// 1. Organization
// ---------------------------------------------------------------------------
console.log(`Seeding sites into ${BASE} (project ${PROJECT}) ...`);
console.log('Organization');
const organization = await upsertManaged(SID.organization, ORGANIZATION.slug, {
  resourceType: 'Organization',
  active: true,
  name: ORGANIZATION.name,
  type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'prov' }] }],
});

// ---------------------------------------------------------------------------
// 2. Locations + 3. HealthcareServices
// ---------------------------------------------------------------------------
const locationsBySlug = {};
const servicesBySite = {};

for (const site of SITES) {
  console.log(`Site ${site.slug}`);
  const location = await upsertManaged(SID.site, site.slug, {
    resourceType: 'Location',
    status: 'active',
    mode: 'instance',
    name: site.name,
    alias: site.nameFr ? [site.nameFr] : undefined,
    description: site.description,
    address: site.address,
    physicalType: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/location-physical-type', code: 'si' }] },
    managingOrganization: ref(organization),
    hoursOfOperation: site.hours.map((h) => ({ daysOfWeek: h.daysOfWeek, openingTime: h.start, closingTime: h.end })),
    extension: [{ url: TIMEZONE_EXT, valueCode: site.timezone ?? TIMEZONE }],
  });
  locationsBySlug[site.slug] = location;

  servicesBySite[site.slug] = [];
  for (const line of SERVICE_LINES) {
    const service = await upsertManaged(SID.healthcareService, `${site.slug}-${line.code}`, {
      resourceType: 'HealthcareService',
      active: true,
      name: line.display,
      comment: line.displayFr,
      providedBy: ref(organization),
      location: [ref(location)],
      type: [{ coding: [{ system: SERVICE_LINE_SYSTEM, code: line.code, display: line.display }], text: line.display }],
      availableTime: availableTime(site),
      extension: [
        {
          url: SCHEDULING_PARAMETERS_EXT,
          extension: [
            { url: 'duration', valueDuration: { value: line.duration, unit: 'min' } },
            { url: 'alignmentInterval', valueDuration: { value: ALIGNMENT_MINUTES, unit: 'min' } },
            { url: 'timezone', valueCode: site.timezone ?? TIMEZONE },
          ],
        },
      ],
    });
    servicesBySite[site.slug].push(service);
  }
}

// ---------------------------------------------------------------------------
// 4. Practitioners: timezone + PractitionerRole per site
// 5. Schedule per (practitioner × site)
// ---------------------------------------------------------------------------
if (SKIP_SCHEDULES) {
  console.log('--skip-schedules: sites and services only, no practitioner diaries created.');
}

const displayName = (p) => {
  const n = p.name?.[0];
  return n?.text ?? [n?.prefix?.join(' '), n?.given?.join(' '), n?.family].filter(Boolean).join(' ') ?? p.id;
};

// Upsert each clinician. An existing record (e.g. one created by an invite) is
// matched on the identifier and keeps its id, telecom and login.
const clinicians = [];
if (!SKIP_SCHEDULES) {
  console.log('Clinicians');
  for (const c of CLINICIANS) {
    const [existing] = await fhir.search('Practitioner', {
      identifier: `${SID.practitioner}|${c.slug}`,
      _count: '1',
    });
    const desired = {
      ...(existing ?? {}),
      resourceType: 'Practitioner',
      active: true,
      identifier: withIdentifier(existing, SID.practitioner, c.slug),
      name: [{ prefix: [c.prefix], given: c.given, family: c.family }],
      qualification: [{ code: { text: c.specialty } }],
      // Required by Schedule/$find and $book unless the service carries a timezone.
      extension: [
        ...((existing?.extension ?? []).filter((e) => e.url !== TIMEZONE_EXT)),
        { url: TIMEZONE_EXT, valueCode: TIMEZONE },
      ],
    };
    const practitioner = existing
      ? await fhir.update({ ...desired, id: existing.id })
      : await fhir.create(desired);
    console.log(`  ${existing ? '=' : '+'} ${displayName(practitioner)} — ${c.specialty} (${c.role})`);
    clinicians.push({ ...c, practitioner });
  }
}

/** Build the CodeableReference-like serviceType entries (see packages/server/src/util/servicetype.ts). */
const toServiceType = (service) =>
  service.type.map((concept) => ({
    ...concept,
    extension: [
      ...(concept.extension ?? []),
      { url: SERVICE_TYPE_REFERENCE_EXT, valueReference: { reference: `HealthcareService/${service.id}` } },
    ],
  }));
const serviceTypeRef = (concept) =>
  (concept.extension ?? []).find((e) => e.url === SERVICE_TYPE_REFERENCE_EXT)?.valueReference?.reference;

const summary = [];
for (const { practitioner, ...c } of clinicians) {
  const siteSlugs = c.sites.filter((slug) => locationsBySlug[slug]);
  if (siteSlugs.length === 0) continue;
  console.log(`Diaries for ${displayName(practitioner)} → ${siteSlugs.join(', ')}`);

  for (const slug of siteSlugs) {
    const location = locationsBySlug[slug];
    // Only the services this clinician offers.
    const services = servicesBySite[slug].filter((s) => c.services.includes(s.type[0].coding[0].code));

    await upsertManaged(SID.practitionerRole, `${practitioner.id}-${slug}`, {
      resourceType: 'PractitionerRole',
      active: true,
      practitioner: { reference: `Practitioner/${practitioner.id}`, display: displayName(practitioner) },
      organization: ref(organization),
      location: [ref(location)],
      specialty: [{ text: c.specialty }],
      code: [{ text: c.role }],
      healthcareService: services.map(ref),
    });

    // Schedule: merge, never clobber staff edits (extensions / toggled serviceType).
    const scheduleKey = `${practitioner.id}-${slug}`;
    const [existing] = await fhir.search('Schedule', { identifier: `${SID.schedule}|${scheduleKey}`, _count: '1' });
    const actor = [
      { reference: `Practitioner/${practitioner.id}`, display: displayName(practitioner) },
      ref(location),
    ];
    let schedule;
    if (existing) {
      const known = new Set((existing.serviceType ?? []).map(serviceTypeRef).filter(Boolean));
      const missing = services.filter((s) => !known.has(`HealthcareService/${s.id}`)).flatMap(toServiceType);
      schedule = await fhir.update({
        ...existing,
        active: true,
        actor,
        identifier: withIdentifier(existing, SID.schedule, scheduleKey),
        serviceType: [...(existing.serviceType ?? []), ...missing],
      });
      console.log(`  = Schedule ${scheduleKey} (updated, +${missing.length} service types)`);
    } else {
      schedule = await fhir.create({
        resourceType: 'Schedule',
        active: true,
        identifier: [identifier(SID.schedule, scheduleKey)],
        actor,
        serviceType: services.flatMap(toServiceType),
        comment: `${displayName(practitioner)} at ${location.name}`,
      });
      console.log(`  + Schedule ${scheduleKey} (created)`);
    }
    summary.push({ practitioner: displayName(practitioner), site: slug, schedule: schedule.id, key: scheduleKey });
  }
}

console.log('\nSchedules (use the key as the Cal.diy event-type slug, see CALDIY.md):');
for (const row of summary) {
  console.log(`  ${row.key}  ${row.practitioner} @ ${row.site}  Schedule/${row.schedule}`);
}
console.log('Sites seeded.');
