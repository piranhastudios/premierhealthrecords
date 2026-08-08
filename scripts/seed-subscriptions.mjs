// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Wires the Premier Health bots to their FHIR Subscriptions. Without these the bots
// are dead code: MRNs are never assigned, BMI never auto-calculates, and — worst —
// tasks gated on payment are never released after the invoice balances.
//
// This script is the single manifest of bot triggers. For each entry it resolves the
// Bot BY NAME (the ids in examples/medplum-demo-bots/medplum.config.json are not
// committed). A missing bot is created and its built code deployed from
// examples/medplum-demo-bots/dist (run `npm run build` there first) — an existing
// bot's code is left alone (`npx medplum bot deploy` remains the update path). The
// Subscription is then upserted, matched by criteria + bot endpoint, so re-running
// never duplicates.
//
// Idempotent: safe to run on every dev start and every deploy.
//
// Usage:
//   node scripts/seed-subscriptions.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin]

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const botsDir = join(here, '..', 'examples', 'medplum-demo-bots');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const BASE = (args.base ?? process.env.MEDPLUM_BASE_URL ?? 'http://localhost:8103').replace(/\/$/, '');
const EMAIL = args.email ?? 'admin@example.com';
const PASSWORD = args.password ?? 'medplum_admin';
// The FHIR R4 data project (where staff and patients live) — the fixed id every
// Medplum server seeds. Bots must live here for their Subscriptions to fire on
// the clinic's data. The admin's membership is created by scripts/seed-users.mjs.
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';

const SUPPORTED_INTERACTION_URL = 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction';
const FHIRPATH_CRITERIA_URL = 'https://medplum.com/fhir/StructureDefinition/fhir-path-criteria-expression';

// One entry per bot-triggered workflow. `criteria` doubles as the upsert match key
// (together with the resolved bot endpoint).
const WIRING = [
  {
    bot: 'premierhealth-assign-patient-id',
    reason: 'Assign the recitable MRN (regYear-birthYear-NNNN) to patients',
    // Create AND update: a patient registered without a birth date is skipped by the
    // bot and picked up when the birth date is recorded.
    criteria: 'Patient',
  },
  {
    bot: 'premierhealth-calculate-bmi',
    reason: 'Auto-calculate BMI when body weight or height is recorded',
    // Narrowed to the two trigger codes so the bot does not fire on its own BMI
    // writes (or on every other vital sign).
    criteria: 'Observation?code=29463-7,8302-2',
  },
  {
    bot: 'premierhealth-release-paid-tasks',
    reason: 'Release awaiting-payment tasks when the invoice balances',
    criteria: 'Invoice?status=balanced',
  },
  {
    bot: 'premierhealth-quickbooks-sync-invoice',
    reason: 'Push balanced Invoices to QuickBooks Online',
    criteria: 'Invoice?status=balanced',
  },
  {
    bot: 'premierhealth-quickbooks-sync-payment',
    reason: 'Push settled payments to QuickBooks Online',
    criteria: 'PaymentReconciliation?status=active',
  },
  {
    bot: 'premierhealth-outbound-dispatch',
    reason: 'Deliver staff replies to WhatsApp / email',
    criteria: 'Communication?part-of:missing=false',
    extension: [
      { url: SUPPORTED_INTERACTION_URL, valueCode: 'create' },
      { url: FHIRPATH_CRITERIA_URL, valueString: "%current.sender.reference.startsWith('Practitioner/')" },
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}

// Login. With `projectId`, the session is scoped to that project (resources are
// created there). Without it, prefer the super-admin console membership — the
// admin also holds a membership in the data project (see seed-users.mjs), which
// makes an unscoped login ambiguous.
async function login(projectId) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const res = await http('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    ...(projectId ? { projectId } : {}),
  });
  let code = res.code;
  if (!code && res.memberships) {
    const membership = res.memberships.find((m) => m.project?.reference !== `Project/${PROJECT}`) ?? res.memberships[0];
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

// Resolve a Bot by exact name in the login project.
async function findBot(token, name) {
  const bundle = await http('GET', `/fhir/R4/Bot?name=${encodeURIComponent(name)}`, undefined, { token });
  return (bundle.entry ?? []).map((e) => e.resource).find((b) => b.name === name);
}

// The bot manifest maps names to built dist files.
const botManifest = JSON.parse(readFileSync(join(botsDir, 'medplum.config.json'), 'utf8')).bots;

// Bot creation/deployment requires the project's `bots` feature flag.
async function ensureBotsFeature(token, projectId) {
  const project = await http('GET', `/fhir/R4/Project/${projectId}`, undefined, { token });
  if (project.features?.includes('bots')) {
    return;
  }
  await http(
    'PUT',
    `/fhir/R4/Project/${projectId}`,
    { ...project, features: [...(project.features ?? []), 'bots'] },
    { token }
  );
  console.log(`  + enabled 'bots' feature on project ${project.name ?? projectId}`);
}

function readDistCode(name) {
  const manifestEntry = botManifest.find((b) => b.name === name);
  const distPath = manifestEntry?.dist ? join(botsDir, manifestEntry.dist) : undefined;
  if (!distPath || !existsSync(distPath)) {
    return undefined;
  }
  return readFileSync(distPath, 'utf8');
}

// Create a missing bot and deploy its built code. Returns undefined (with a warning)
// when the dist file has not been built.
async function createAndDeployBot(token, projectId, name, reason) {
  const code = readDistCode(name);
  if (!code) {
    console.log(`  ! ${name}: bot not found and no built code in ${botsDir}/dist`);
    return undefined;
  }
  const bot = await http('POST', `/admin/projects/${projectId}/bot`, { name, description: reason }, { token });
  await http('POST', `/fhir/R4/Bot/${bot.id}/$deploy`, { code }, { token });
  console.log(`  + ${name}: bot created and code deployed`);
  return bot;
}

// A bot that exists but has never had code deployed (e.g. an earlier partial run of
// this script, or `bot create` without `bot deploy`) is a silent no-op — repair it.
async function ensureBotCode(token, bot) {
  if (bot.executableCode?.url) {
    return;
  }
  const code = readDistCode(bot.name);
  if (!code) {
    console.log(`  ! ${bot.name}: bot has no deployed code and no built dist to deploy`);
    return;
  }
  await http('POST', `/fhir/R4/Bot/${bot.id}/$deploy`, { code }, { token });
  console.log(`  + ${bot.name}: deployed code to code-less bot`);
}

// Upsert one Subscription, matched by criteria + bot endpoint.
async function ensureSubscription(token, bot, { reason, criteria, extension }) {
  const endpoint = `Bot/${bot.id}`;
  const desired = {
    resourceType: 'Subscription',
    status: 'active',
    reason,
    criteria,
    channel: { type: 'rest-hook', endpoint },
    ...(extension ? { extension } : {}),
  };

  const bundle = await http('GET', `/fhir/R4/Subscription?criteria=${encodeURIComponent(criteria)}`, undefined, {
    token,
  });
  const existing = (bundle.entry ?? []).map((e) => e.resource).find((s) => s.channel?.endpoint === endpoint);

  if (existing) {
    await http('PUT', `/fhir/R4/Subscription/${existing.id}`, { ...desired, id: existing.id }, { token });
    console.log(`  = ${bot.name}: Subscription on "${criteria}" (updated)`);
  } else {
    await http('POST', '/fhir/R4/Subscription', desired, { token });
    console.log(`  + ${bot.name}: Subscription on "${criteria}" (created)`);
  }
}

console.log(`Wiring bot subscriptions on ${BASE} (project ${PROJECT}) ...`);

// Enabling the project's `bots` feature is a Project-resource write — super admin
// only, so use the unscoped console login for just that step.
await ensureBotsFeature(await login(), PROJECT);

// Everything else runs scoped to the data project: bot search/create/deploy and
// the Subscriptions land there naturally.
const token = await login(PROJECT);

const missing = [];
for (const entry of WIRING) {
  let bot = await findBot(token, entry.bot);
  if (bot) {
    await ensureBotCode(token, bot);
  } else {
    bot = await createAndDeployBot(token, PROJECT, entry.bot, entry.reason);
  }
  if (!bot) {
    missing.push(entry.bot);
    continue;
  }
  await ensureSubscription(token, bot, entry);
}

if (missing.length) {
  console.log(
    `\nACTION REQUIRED — ${missing.length} bot(s) could not be wired, so their workflows stay` +
      ` inert:\n${missing.map((m) => `  - ${m}`).join('\n')}\n` +
      `Build the bots (cd examples/medplum-demo-bots && npm run build), then re-run this script.\n` +
      `See src/premierhealth/SETUP.md.`
  );
} else {
  console.log('\nAll bot subscriptions wired.');
}
