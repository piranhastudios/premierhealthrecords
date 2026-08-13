// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
//
// Marketing / campaign-engine preflight. Run by `scripts/dev.sh` after the
// seeds, or on its own at any time.
//
// The campaign engine fails SILENTLY when its prerequisites are missing: no
// Resend secrets means every send errors into a retry/on-hold loop, no `cron`
// feature means the executor never ticks, and an unregistered webhook means
// opens/clicks/bounces never come back (so condition nodes never fire and
// suppression never happens). This script checks each one and prints what is
// still manual.
//
// Usage:
//   node scripts/marketing-preflight.mjs [--base http://localhost:8103] \
//     [--email admin@example.com] [--password medplum_admin]

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
const PROJECT = args.project ?? '161452d9-43b7-5c29-aa7b-c85680fa45c6';

const OK = '  ✓';
const WARN = '  !';

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

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

const manual = [];

console.log('\nMarketing / campaign preflight ...');

// This runs on every dev start, so an unreachable server should report one
// line rather than a stack trace.
let token;
try {
  token = await login(PROJECT);
} catch (err) {
  console.log(`${WARN} cannot reach ${BASE} (${err instanceof Error ? err.message.split('\n')[0] : err})`);
  console.log('  skipped — run `node scripts/marketing-preflight.mjs` once the server is up.\n');
  process.exit(0);
}
const project = await http('GET', `/fhir/R4/Project/${PROJECT}`, undefined, { token });
const features = project.features ?? [];
const secrets = new Set((project.secret ?? []).map((s) => s.name));

// 1. Resend credentials — without these every campaign send throws.
if (secrets.has('RESEND_API_KEY') && secrets.has('RESEND_FROM_ADDRESS')) {
  console.log(`${OK} Resend secrets set (sends enabled)`);
} else {
  console.log(`${WARN} Resend secrets MISSING — campaign sends will fail`);
  manual.push('Set RESEND_API_KEY + RESEND_FROM_ADDRESS in the admin app: Project → Secrets');
}

// 2. Cron feature — without it the executor Bot never ticks.
if (features.includes('cron')) {
  console.log(`${OK} 'cron' feature enabled (executor ticks)`);
} else {
  console.log(`${WARN} 'cron' feature MISSING — the campaign executor will never run`);
  manual.push('Run: node scripts/seed-users.mjs (enables the cron feature)');
}

// 3. AI feature — optional; gates the template assistant.
console.log(
  features.includes('ai')
    ? `${OK} 'ai' feature enabled (template AI assistant visible)`
    : `${OK} 'ai' feature off (template AI assistant hidden — optional)`
);

// 4. Campaign bots: deployed code + the executor's cron schedule.
const bots = await http('GET', '/fhir/R4/Bot?name:contains=campaign&_count=20', undefined, { token });
const byName = new Map((bots.entry ?? []).map((e) => [e.resource.name, e.resource]));
for (const name of ['premierhealth-campaign-trigger', 'premierhealth-campaign-executor', 'premierhealth-campaign-resend-events']) {
  const bot = byName.get(name);
  if (!bot) {
    console.log(`${WARN} ${name}: NOT wired`);
    manual.push('Run: (cd examples/medplum-demo-bots && npm run build) && node scripts/seed-subscriptions.mjs');
    continue;
  }
  if (!bot.executableCode?.url) {
    console.log(`${WARN} ${name}: no deployed code`);
    manual.push(`Deploy code for ${name}: node scripts/seed-subscriptions.mjs`);
    continue;
  }
  if (name.endsWith('executor') && !bot.cronString) {
    console.log(`${WARN} ${name}: no cron schedule`);
    manual.push('Run: node scripts/seed-subscriptions.mjs (sets the executor cronString)');
    continue;
  }
  console.log(`${OK} ${name}${bot.cronString ? ` (cron ${bot.cronString})` : ''}`);
}

// 5. Webhook URL for the Resend dashboard (delivery events + suppression).
const webhookBot = byName.get('premierhealth-campaign-resend-events');
if (webhookBot) {
  const memberships = await http('GET', `/fhir/R4/ProjectMembership?profile=Bot/${webhookBot.id}`, undefined, { token });
  const membership = memberships.entry?.[0]?.resource;
  if (membership && webhookBot.publicWebhook) {
    console.log(`${OK} Resend webhook URL: ${BASE}/webhook/${membership.id}`);
    manual.push(
      `Register that webhook URL in the Resend dashboard (events: delivered, opened, clicked, bounced, complained)`
    );
  } else {
    console.log(`${WARN} webhook bot not public / has no membership`);
    manual.push('Run: node scripts/seed-subscriptions.mjs (enables publicWebhook + policy)');
  }
}

// 6. Marketing operator login.
const marketingUser = await http('GET', '/fhir/R4/AccessPolicy?name=Marketing / Outreach', undefined, { token }).catch(
  () => ({})
);
console.log(
  (marketingUser.entry ?? []).length
    ? `${OK} Marketing access policy installed (marketing@example.com / medplum_user)`
    : `${WARN} Marketing access policy missing — run node scripts/seed-users.mjs`
);

// The campaign UI lives in the admin app, which dev.sh only starts with
// --with-admin (and it lands on :3001 because the provider takes :3000).
console.log('\nCampaign UI — admin app, start it with: scripts/dev.sh --with-admin');
console.log('  Campaigns:  http://localhost:3001/admin/campaigns');
console.log('  Templates:  http://localhost:3001/admin/templates');

if (manual.length) {
  console.log('\nStill manual:');
  for (const item of [...new Set(manual)]) {
    console.log(`  - ${item}`);
  }
}
console.log('');
