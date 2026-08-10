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
// Wire every clinic project on the server rather than just one. Bots and their
// Subscriptions are project-scoped, so each clinic needs its own copies.
const ALL_PROJECTS = process.argv.includes('--all-projects');

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
  // --- Campaign engine ------------------------------------------------------------
  // One trigger bot behind several static Subscriptions; the bot's registry decides
  // which active campaigns an incoming resource feeds.
  {
    bot: 'premierhealth-campaign-trigger',
    reason: 'Enrol patients into campaigns (patient-created trigger)',
    criteria: 'Patient',
  },
  {
    bot: 'premierhealth-campaign-trigger',
    reason: 'Enrol patients into campaigns (appointment triggers)',
    criteria: 'Appointment',
  },
  {
    bot: 'premierhealth-campaign-trigger',
    reason: 'Enrol patients into campaigns (encounter-finished trigger)',
    criteria: 'Encounter?status=finished',
  },
  {
    bot: 'premierhealth-campaign-trigger',
    reason: 'Enrol patients into campaigns (consent-granted trigger)',
    criteria: 'Consent',
  },
  {
    bot: 'premierhealth-campaign-executor',
    reason: 'Process due campaign enrolments (sends, delays, conditions)',
    // Cron bot — no Subscription. Requires the project `cron` feature (seed-users.mjs).
    cron: '*/2 * * * *',
  },
  {
    bot: 'premierhealth-campaign-resend-events',
    reason: 'Ingest Resend delivery events (delivered/opened/clicked/bounced/complained)',
    // Public webhook — register the printed URL in the Resend dashboard.
    publicWebhook: true,
    // Minimal policy for the anonymous webhook route: event append (Communication),
    // suppression (Patient tag + Consent deny), enrolment cancellation (Task).
    webhookPolicy: ['Communication', 'Patient', 'Consent', 'Task'],
  },
  {
    bot: 'premierhealth-campaign-unsubscribe',
    reason: 'Handle signed unsubscribe links from marketing email footers',
    // Public webhook. Its URL + HMAC secret are stored as project secrets so the
    // executor can generate per-recipient links (see ensureUnsubscribeSecrets).
    publicWebhook: true,
    webhookPolicy: ['Patient', 'Consent', 'Task'],
    unsubscribeEndpoint: true,
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

// Features every clinic project needs: `bots` to create/deploy bots at all,
// `cron` for the campaign executor's schedule, `websocket-subscriptions` for the
// provider dashboard's live feeds.
const REQUIRED_FEATURES = ['bots', 'cron', 'websocket-subscriptions'];

async function ensureProjectFeatures(token, projectId) {
  const project = await http('GET', `/fhir/R4/Project/${projectId}`, undefined, { token });
  const features = project.features ?? [];
  const missingFeatures = REQUIRED_FEATURES.filter((f) => !features.includes(f));
  if (missingFeatures.length === 0) {
    return;
  }
  await http('PUT', `/fhir/R4/Project/${projectId}`, { ...project, features: [...features, ...missingFeatures] }, { token });
  console.log(`  + enabled features on ${project.name ?? projectId}: ${missingFeatures.join(', ')}`);
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

// Ensure a cron bot runs on the given schedule (Bot.cronString). Requires the
// project `cron` feature (see seed-users.mjs ensureCronFeature) or the server
// worker skips it silently (packages/server/src/workers/cron.ts).
async function ensureBotCron(token, bot, cron) {
  // Re-read: the in-hand copy may predate $deploy, and PUTting it would wipe
  // Bot.executableCode (deployed code lives on the resource).
  const fresh = await http('GET', `/fhir/R4/Bot/${bot.id}`, undefined, { token });
  if (fresh.cronString === cron) {
    return;
  }
  await http('PUT', `/fhir/R4/Bot/${bot.id}`, { ...fresh, cronString: cron }, { token });
  console.log(`  + ${bot.name}: cron schedule set (${cron})`);
}

// Ensure a bot is exposed as a public webhook and print the URL to register with
// the external service (Resend dashboard). The anonymous webhook route refuses
// memberships without an AccessPolicy (packages/server/src/webhook/routes.ts),
// so a minimal bot policy is upserted and attached too.
// Provision the project secrets that make unsubscribe links automatic: the
// unsubscribe bot's public webhook URL and the HMAC key used to sign each
// recipient's link. Operators never configure an unsubscribe URL.
async function ensureUnsubscribeSecrets(token, projectId, webhookUrl) {
  const project = await http('GET', `/fhir/R4/Project/${projectId}`, undefined, { token });
  const secrets = [...(project.secret ?? [])];
  const existingUrl = secrets.find((s) => s.name === 'CAMPAIGN_UNSUBSCRIBE_URL');
  const hasSecret = secrets.some((s) => s.name === 'CAMPAIGN_UNSUBSCRIBE_SECRET');
  let changed = false;

  if (existingUrl?.valueString !== webhookUrl) {
    if (existingUrl) {
      existingUrl.valueString = webhookUrl;
    } else {
      secrets.push({ name: 'CAMPAIGN_UNSUBSCRIBE_URL', valueString: webhookUrl });
    }
    changed = true;
  }
  if (!hasSecret) {
    secrets.push({ name: 'CAMPAIGN_UNSUBSCRIBE_SECRET', valueString: randomBytes(32).toString('hex') });
    changed = true;
  }
  if (changed) {
    await http('PUT', `/fhir/R4/Project/${projectId}`, { ...project, secret: secrets }, { token });
    console.log('  + unsubscribe secrets provisioned (URL + signing key)');
  }
}

async function ensureBotWebhook(token, bot, policyResources) {
  // Re-read before PUT — see ensureBotCron.
  const fresh = await http('GET', `/fhir/R4/Bot/${bot.id}`, undefined, { token });
  if (!fresh.publicWebhook) {
    await http('PUT', `/fhir/R4/Bot/${bot.id}`, { ...fresh, publicWebhook: true }, { token });
    console.log(`  + ${bot.name}: publicWebhook enabled`);
  }

  // Upsert the bot's scoped policy (named after the bot).
  const policyName = `${bot.name} webhook policy`;
  const policySearch = await http('GET', `/fhir/R4/AccessPolicy?name=${encodeURIComponent(policyName)}`, undefined, {
    token,
  });
  const desiredPolicy = {
    resourceType: 'AccessPolicy',
    name: policyName,
    resource: policyResources.map((resourceType) => ({ resourceType })),
  };
  const existingPolicy = (policySearch.entry ?? []).map((e) => e.resource).find((p) => p.name === policyName);
  const policy = existingPolicy
    ? await http('PUT', `/fhir/R4/AccessPolicy/${existingPolicy.id}`, { ...desiredPolicy, id: existingPolicy.id }, { token })
    : await http('POST', '/fhir/R4/AccessPolicy', desiredPolicy, { token });

  const memberships = await http('GET', `/fhir/R4/ProjectMembership?profile=Bot/${bot.id}`, undefined, { token });
  const membership = memberships.entry?.[0]?.resource;
  if (!membership) {
    console.log(`  ! ${bot.name}: no ProjectMembership found — cannot derive webhook URL`);
    return undefined;
  }
  if (membership.accessPolicy?.reference !== `AccessPolicy/${policy.id}`) {
    await http(
      'PUT',
      `/fhir/R4/ProjectMembership/${membership.id}`,
      { ...membership, accessPolicy: { reference: `AccessPolicy/${policy.id}` } },
      { token }
    );
    console.log(`  + ${bot.name}: webhook access policy attached`);
  }
  const webhookUrl = `${BASE}/webhook/${membership.id}`;
  console.log(`  i ${bot.name}: webhook URL ${webhookUrl}`);
  return webhookUrl;
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

// Bots, Subscriptions and their counters are PER PROJECT. Each clinic is its own
// project, so a clinic without this wiring silently loses every bot workflow —
// no MRNs assigned, no BMI, no pay-gate release, no campaigns. `--all-projects`
// wires every clinic on the server (everything except the Super Admin project).
async function wireProject(superToken, projectId, projectName) {
  console.log(`\n--- ${projectName ?? projectId} ---`);
  await ensureProjectFeatures(superToken, projectId);

  // Scoped to the data project: bot search/create/deploy and the Subscriptions
  // land there naturally.
  const token = await login(projectId);
  const missing = [];

  for (const entry of WIRING) {
    let bot = await findBot(token, entry.bot);
    if (bot) {
      await ensureBotCode(token, bot);
    } else {
      bot = await createAndDeployBot(token, projectId, entry.bot, entry.reason);
    }
    if (!bot) {
      missing.push(entry.bot);
      continue;
    }
    if (entry.cron) {
      await ensureBotCron(token, bot, entry.cron);
    }
    if (entry.publicWebhook) {
      const webhookUrl = await ensureBotWebhook(token, bot, entry.webhookPolicy ?? []);
      if (entry.unsubscribeEndpoint && webhookUrl) {
        await ensureUnsubscribeSecrets(superToken, projectId, webhookUrl);
      }
    }
    if (entry.criteria) {
      await ensureSubscription(token, bot, entry);
    }
  }
  return missing;
}

console.log(`Wiring bot subscriptions on ${BASE} ...`);

// Project-resource writes (features, secrets) are super-admin only, so keep the
// unscoped console login around (re-logging in risks the auth rate limit).
const superToken = await login();

let targets;
if (ALL_PROJECTS) {
  const bundle = await http('GET', '/fhir/R4/Project?_count=100', undefined, { token: superToken });
  targets = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((p) => !p.superAdmin)
    .map((p) => ({ id: p.id, name: p.name }));
  console.log(`Targeting ${targets.length} clinic project(s): ${targets.map((t) => t.name).join(', ')}`);
} else {
  targets = [{ id: PROJECT, name: PROJECT }];
}

const missing = [];
for (const target of targets) {
  // A project the admin has no membership in cannot be wired — report and move on
  // rather than aborting the whole run.
  try {
    missing.push(...(await wireProject(superToken, target.id, target.name)));
  } catch (err) {
    console.log(`  ! ${target.name}: skipped (${err.message.split('\n')[0]})`);
  }
}

if (missing.length) {
  const unique = [...new Set(missing)];
  console.log(
    `\nACTION REQUIRED — ${unique.length} bot(s) could not be wired, so their workflows stay` +
      ` inert:\n${unique.map((m) => `  - ${m}`).join('\n')}\n` +
      `Build the bots (cd examples/medplum-demo-bots && npm run build), then re-run this script.\n` +
      `See src/premierhealth/SETUP.md.`
  );
} else {
  console.log('\nAll bot subscriptions wired.');
}
