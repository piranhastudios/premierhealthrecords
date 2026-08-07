// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Premier Health contributors
// SPDX-License-Identifier: Apache-2.0
//
// Rotating-QR server operations for Premier Health Cameroon.
//
// Three handlers back the Expo patient-portal rotating QR:
//   - Patient/$qr-enroll  (instance)     -> provisions opaque handle + offline TOTP secret
//   - Patient/$issue-qr   (instance)     -> mints a short-lived signed JWS for the online path
//   - Patient/$verify-qr  (type, staff)  -> a provider scanner verifies an online JWS or an
//                                           offline TOTP code, burns the single-use nonce, and
//                                           executes the scanned intent.
//
// Security model: nothing sensitive is persisted. The per-patient `handle` and the offline
// `secret` are HMAC derivations of a single project signing key (QR_SIGNING_KEY) over the
// patient id, so the verify endpoint can recompute them on demand. The only stored artefacts
// are (a) a stable qr-handle identifier on the Patient so verify can resolve handle -> patient,
// and (b) single-use nonce markers (Basic resources) used to defeat replay.
import { allOk, badRequest, createReference, getDisplayString, Operator } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type {
  Appointment,
  Basic,
  OperationDefinition,
  ParametersParameter,
  Patient,
  Project,
} from '@medplum/fhirtypes';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAuthenticatedContext } from '../../context';
import type { Repository } from '../repo';
import { parseInputParameters } from './utils/parameters';

// FHIR identifier/marker systems (mirror examples/patient-portal/src/lib/constants.ts).
export const QR_HANDLE_SYSTEM = 'https://premierhealth.cm/fhir/sid/qr-handle';
export const QR_NONCE_SYSTEM = 'https://premierhealth.cm/fhir/sid/qr-nonce';

// Online JWS lifetime and offline TOTP parameters. Mirror the client
// (examples/patient-portal/src/lib/constants.ts: QR_TOKEN_TTL_MS, QR_TOTP_STEP_SEC). The time
// step is always derived from the SERVER clock — a client-claimed step is never trusted,
// otherwise a captured 30s code would be redeemable forever.
const QR_TOKEN_TTL_SEC = 60;
const QR_TOTP_DIGITS = 8;
const QR_TOTP_STEP_SEC = 30;

type QrIntent = 'id' | 'checkin' | 'pay' | 'grant';
const VALID_INTENTS: ReadonlySet<string> = new Set<QrIntent>(['id', 'checkin', 'pay', 'grant']);
// High-impact intents that must NEVER be honoured offline (mirror client ONLINE_ONLY_INTENTS).
const ONLINE_ONLY_INTENTS: ReadonlySet<string> = new Set<QrIntent>(['pay', 'grant']);

// ---------------------------------------------------------------------------
// Crypto core
// ---------------------------------------------------------------------------

/**
 * Resolves the HMAC signing key from project secrets, falling back to a server env var for
 * single-tenant on-prem deployments (e.g. set QR_SIGNING_KEY in the Coolify/Docker env).
 * @param project - The current project.
 * @returns The resolved signing key.
 */
export function getQrKey(project: Project): string {
  const key = project.secret?.find((s) => s.name === 'QR_SIGNING_KEY')?.valueString ?? process.env.QR_SIGNING_KEY;
  if (!key) {
    throw new Error('QR signing key not configured (set the QR_SIGNING_KEY project secret or environment variable)');
  }
  return key;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlJson(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

function hmacSha256(key: string, msg: string | Buffer): Buffer {
  return createHmac('sha256', key).update(msg).digest();
}

/**
 * Derives the opaque, stable QR handle for a patient. Never the CNI/MRN.
 * handle = base64url(HMAC_SHA256(key, 'handle:'+patientId)).slice(0, 22)
 * @param key - The QR signing key.
 * @param patientId - The patient logical id.
 * @returns A 22-char opaque handle.
 */
export function deriveHandle(key: string, patientId: string): string {
  return base64url(hmacSha256(key, 'handle:' + patientId)).slice(0, 22);
}

/**
 * Derives the offline TOTP secret (base64) for a patient. The client base64-decodes this and
 * concatenates `:${intent}` before running RFC-6238 (see totpOffline.ts).
 * offlineSecret = base64(HMAC_SHA256(key, 'totp:'+patientId))
 * @param key - The QR signing key.
 * @param patientId - The patient logical id.
 * @returns A base64-encoded secret.
 */
export function deriveOfflineSecret(key: string, patientId: string): string {
  return hmacSha256(key, 'totp:' + patientId).toString('base64');
}

interface QrJwsPayload {
  v: 1;
  pid: string; // the opaque handle
  intent: QrIntent;
  nonce: string;
  iat: number;
  exp: number;
  ctx?: string;
}

/**
 * Signs a compact HS256 JWS over the given payload. No external JWT lib — header + payload +
 * HMAC-SHA256, all base64url, joined by dots.
 * @param key - The QR signing key.
 * @param payload - The JWS payload.
 * @returns The compact JWS string.
 */
export function signJws(key: string, payload: QrJwsPayload): string {
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64urlJson(payload);
  const signingInput = `${header}.${body}`;
  const sig = base64url(hmacSha256(key, signingInput));
  return `${signingInput}.${sig}`;
}

/**
 * Verifies a compact HS256 JWS: checks the signature (constant-time) and expiry.
 * @param key - The QR signing key.
 * @param token - The compact JWS string.
 * @returns The decoded payload.
 * @throws Error when the token is malformed, the signature is invalid, or it has expired.
 */
export function verifyJws(key: string, token: string): QrJwsPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [header, body, sig] = parts;
  const expected = base64url(hmacSha256(key, `${header}.${body}`));
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }
  let payload: QrJwsPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as QrJwsPayload;
  } catch {
    throw new Error('Malformed token payload');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token has expired');
  }
  return payload;
}

/**
 * RFC-6238 TOTP, recomputed server-side to match the client exactly
 * (examples/patient-portal/src/qr/crypto.ts): HMAC-SHA1 over an 8-byte big-endian counter
 * (= the time step), dynamic truncation, `digits` decimal digits zero-padded.
 * @param secret - The HMAC key bytes.
 * @param step - floor(epochSeconds / period).
 * @param digits - Number of output digits (default 8).
 * @returns The zero-padded TOTP code.
 */
export function totp(secret: Buffer, step: number, digits = QR_TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  // Big-endian 8-byte counter. JS bitwise ops are 32-bit, so build byte-by-byte (matches client).
  let value = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  const hash = createHmac('sha1', secret).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Matches a presented offline TOTP code against SERVER-derived time steps only: the current step
 * plus ±1 for clock skew. The client never gets to claim which step the code belongs to, so a
 * captured code is only redeemable within its real ~90s window. Every matching step is returned
 * (constant-time compared) so the caller can burn all of them and the ±1 tolerance cannot be
 * double-spent.
 * @param secret - The HMAC key bytes (offline secret ++ ':'+intent, see the caller).
 * @param code - The presented TOTP code.
 * @param serverStep - floor(serverEpochSeconds / period), computed from the server clock.
 * @param digits - Number of TOTP digits (default 8).
 * @returns The server steps in {serverStep-1, serverStep, serverStep+1} whose TOTP equals the code.
 */
export function matchOfflineCodeSteps(
  secret: Buffer,
  code: string,
  serverStep: number,
  digits = QR_TOTP_DIGITS
): number[] {
  const candidate = Buffer.from(code);
  const matched: number[] = [];
  for (const step of [serverStep - 1, serverStep, serverStep + 1]) {
    const expected = Buffer.from(totp(secret, step, digits));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      matched.push(step);
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a Patient from its opaque QR handle via the stable qr-handle identifier.
 * @param repo - The FHIR repository to search with.
 * @param handle - The opaque QR handle.
 * @returns The matching Patient, or undefined.
 */
async function resolvePatientByHandle(repo: Repository, handle: string): Promise<Patient | undefined> {
  return repo.searchOne<Patient>({
    resourceType: 'Patient',
    filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `${QR_HANDLE_SYSTEM}|${handle}` }],
  });
}

/**
 * Single-use nonce guard. Atomically burns a nonce by creating a Basic marker keyed on it; if the
 * marker already exists, the nonce has been used and the caller must reject the scan as a replay.
 * @param repo - The FHIR repository.
 * @param value - The nonce value (JWS nonce, or a derived `handle:intent:step` tuple).
 * @returns true if the nonce was fresh (and is now burned); false if it was already used.
 */
async function burnNonce(repo: Repository, value: string): Promise<boolean> {
  const existing = await repo.searchOne<Basic>({
    resourceType: 'Basic',
    filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `${QR_NONCE_SYSTEM}|${value}` }],
  });
  if (existing) {
    return false;
  }
  await repo.createResource<Basic>({
    resourceType: 'Basic',
    code: { coding: [{ system: 'https://premierhealth.cm/fhir/CodeSystem/basic-type', code: 'qr-nonce' }] },
    created: new Date().toISOString(),
    identifier: [{ system: QR_NONCE_SYSTEM, value }],
  });
  return true;
}

/**
 * Executes a verified scan intent and returns the OUT parameters.
 * @param repo - The FHIR repository.
 * @param patient - The resolved patient.
 * @param intent - The scanned intent.
 * @returns The OUT ParametersParameter list.
 */
async function executeIntent(repo: Repository, patient: Patient, intent: QrIntent): Promise<ParametersParameter[]> {
  let status: string;
  switch (intent) {
    case 'checkin': {
      // Find today's booked/arrived appointment for this patient and mark it arrived.
      const today = new Date().toISOString().slice(0, 10);
      const appt = await repo.searchOne<Appointment>({
        resourceType: 'Appointment',
        filters: [
          { code: 'patient', operator: Operator.EQUALS, value: `Patient/${patient.id}` },
          { code: 'date', operator: Operator.EQUALS, value: today },
          { code: 'status', operator: Operator.EQUALS, value: 'booked,arrived' },
        ],
      });
      if (appt) {
        if (appt.status !== 'arrived') {
          await repo.updateResource<Appointment>({ ...appt, status: 'arrived' });
        }
        status = 'arrived';
      } else {
        status = 'no-appointment';
      }
      break;
    }
    case 'pay':
      // The scanning station drives the existing payment flow ($pay/$checkout) — do not charge here.
      status = 'pay-ready';
      break;
    case 'grant':
      // The actual grant Consent is created by Patient/$grant once the provider confirms.
      status = 'grant-pending';
      break;
    case 'id':
    default:
      status = 'verified';
      break;
  }

  return [
    { name: 'patient', valueReference: createReference(patient) },
    { name: 'patientName', valueString: getDisplayString(patient) },
    { name: 'intent', valueString: intent },
    { name: 'status', valueString: status },
  ];
}

// ---------------------------------------------------------------------------
// Patient/$qr-enroll
// ---------------------------------------------------------------------------

const enrollOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-qr-enroll',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-qr-enroll',
  name: 'qrEnroll',
  status: 'active',
  kind: 'operation',
  code: 'qr-enroll',
  resource: ['Patient'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    { name: 'handle', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'secret', use: 'out', min: 1, max: '1', type: 'string' },
  ],
};

/**
 * Handles Patient/$qr-enroll: provisions the opaque handle + offline TOTP secret for this patient,
 * and upserts a stable qr-handle identifier so $verify-qr can resolve handle -> patient. Both
 * values are HMAC derivations of the project key, so re-enrolling is idempotent.
 * @param req - The FHIR request (instance-level on Patient).
 * @returns Parameters with `handle` and `secret`.
 */
export async function patientQrEnrollHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  let key: string;
  try {
    key = getQrKey(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  // No input parameters, but parse against the definition for parity with the other handlers.
  parseInputParameters(enrollOperation, req);

  const patient = await ctx.repo.readResource<Patient>('Patient', id);
  const handle = deriveHandle(key, patient.id as string);
  const secret = deriveOfflineSecret(key, patient.id as string);

  // Upsert the qr-handle identifier if not already present.
  const hasHandle = patient.identifier?.some((i) => i.system === QR_HANDLE_SYSTEM && i.value === handle);
  if (!hasHandle) {
    await ctx.repo.updateResource<Patient>({
      ...patient,
      identifier: [...(patient.identifier ?? []), { system: QR_HANDLE_SYSTEM, value: handle }],
    });
  }

  const out: ParametersParameter[] = [
    { name: 'handle', valueString: handle },
    { name: 'secret', valueString: secret },
  ];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}

// ---------------------------------------------------------------------------
// Patient/$issue-qr
// ---------------------------------------------------------------------------

const issueOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-issue-qr',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-issue-qr',
  name: 'issueQr',
  status: 'active',
  kind: 'operation',
  code: 'issue-qr',
  resource: ['Patient'],
  system: false,
  type: false,
  instance: true,
  parameter: [
    { name: 'intent', use: 'in', min: 1, max: '1', type: 'string' },
    { name: 'context', use: 'in', min: 0, max: '1', type: 'string' },
    { name: 'jws', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'exp', use: 'out', min: 1, max: '1', type: 'integer' },
  ],
};

interface IssueQrParameters {
  intent: string;
  context?: string;
}

/**
 * Handles Patient/$issue-qr: mints a short-lived signed JWS (60s) for this patient + intent. The
 * payload references the opaque handle, never PHI; a fresh single-use nonce defeats replay at
 * verify time.
 * @param req - The FHIR request (instance-level on Patient).
 * @returns Parameters with `jws` (string) and `exp` (epoch seconds).
 */
export async function patientIssueQrHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { id } = req.params;

  let key: string;
  try {
    key = getQrKey(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const params = parseInputParameters<IssueQrParameters>(issueOperation, req);
  if (!params.intent || !VALID_INTENTS.has(params.intent)) {
    return [badRequest('Invalid or missing intent')];
  }

  const patient = await ctx.repo.readResource<Patient>('Patient', id);
  const handle = deriveHandle(key, patient.id as string);

  // Ensure the stable qr-handle identifier exists so $verify-qr can resolve
  // handle -> patient. Online issuance may happen without a prior $qr-enroll
  // (see useRotatingQr online path), so upsert it here too. Idempotent: after
  // the first issuance the identifier is present and this is a no-op.
  const hasHandle = patient.identifier?.some((i) => i.system === QR_HANDLE_SYSTEM && i.value === handle);
  if (!hasHandle) {
    await ctx.repo.updateResource<Patient>({
      ...patient,
      identifier: [...(patient.identifier ?? []), { system: QR_HANDLE_SYSTEM, value: handle }],
    });
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + QR_TOKEN_TTL_SEC;
  const jws = signJws(key, {
    v: 1,
    pid: handle,
    intent: params.intent as QrIntent,
    nonce: randomUUID(),
    iat,
    exp,
    ctx: params.context,
  });

  const out: ParametersParameter[] = [
    { name: 'jws', valueString: jws },
    { name: 'exp', valueInteger: exp },
  ];
  return [allOk, { resourceType: 'Parameters', parameter: out }];
}

// ---------------------------------------------------------------------------
// Patient/$verify-qr  (type-level, provider-authenticated)
// ---------------------------------------------------------------------------

const verifyOperation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'patient-verify-qr',
  url: 'https://premierhealth.cm/fhir/OperationDefinition/patient-verify-qr',
  name: 'verifyQr',
  status: 'active',
  kind: 'operation',
  code: 'verify-qr',
  resource: ['Patient'],
  system: false,
  type: true,
  instance: false,
  parameter: [
    { name: 'token', use: 'in', min: 0, max: '1', type: 'string' },
    { name: 'handle', use: 'in', min: 0, max: '1', type: 'string' },
    { name: 'intent', use: 'in', min: 0, max: '1', type: 'string' },
    { name: 'code', use: 'in', min: 0, max: '1', type: 'string' },
    {
      name: 'step',
      use: 'in',
      min: 0,
      max: '1',
      type: 'integer',
      documentation:
        'Deprecated: accepted for client compatibility but ignored; the server derives the time step from its own clock.',
    },
    { name: 'patient', use: 'out', min: 1, max: '1', type: 'Reference' },
    { name: 'patientName', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'intent', use: 'out', min: 1, max: '1', type: 'string' },
    { name: 'status', use: 'out', min: 1, max: '1', type: 'string' },
  ],
};

interface VerifyQrParameters {
  token?: string;
  handle?: string;
  intent?: string;
  code?: string;
  step?: number;
}

/**
 * Handles Patient/$verify-qr (provider/staff authenticated). Two paths:
 *  - Online: `token` (the JWS) is verified (signature + expiry), its single-use nonce is burned to
 *    block replay, then the patient is resolved from the embedded handle.
 *  - Offline: `handle`/`intent`/`code` recompute the expected RFC-6238 TOTP server-side using the
 *    SAME algorithm as the client (HMAC-SHA1, 30s step, 8 digits, secret = base64-decoded
 *    offlineSecret ++ utf8(':'+intent)). The time step is derived from the SERVER clock (±1 step
 *    of skew tolerance); any client-claimed `step` is ignored for validity. Offline is refused for
 *    the high-impact intents ('pay'/'grant'). Every matched (handle,intent,serverStep) tuple is
 *    burned as a nonce too.
 * On success the scanned intent is executed and the patient ref + name + status returned.
 * @param req - The FHIR request (type-level on Patient).
 * @returns Parameters with `patient`, `patientName`, `intent`, `status`.
 */
export async function patientVerifyQrHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();

  let key: string;
  try {
    key = getQrKey(ctx.project);
  } catch (error) {
    return [badRequest((error as Error).message)];
  }

  const params = parseInputParameters<VerifyQrParameters>(verifyOperation, req);

  // -------------------- Online path (JWS) --------------------
  if (params.token) {
    let payload: QrJwsPayload;
    try {
      payload = verifyJws(key, params.token);
    } catch (error) {
      return [badRequest((error as Error).message)];
    }

    // Single-use: burn the nonce before honouring the token.
    const fresh = await burnNonce(ctx.repo, payload.nonce);
    if (!fresh) {
      return [badRequest('Token already used')];
    }

    const patient = await resolvePatientByHandle(ctx.repo, payload.pid);
    if (!patient) {
      return [badRequest('Unknown QR handle')];
    }

    const out = await executeIntent(ctx.repo, patient, payload.intent);
    return [allOk, { resourceType: 'Parameters', parameter: out }];
  }

  // -------------------- Offline path (TOTP) --------------------
  // NOTE: `step` may still be sent by older clients but is deliberately ignored — trusting a
  // client-claimed step would make a captured code redeemable forever.
  if (params.handle && params.intent && params.code) {
    const intent = params.intent;
    if (!VALID_INTENTS.has(intent)) {
      return [badRequest('Invalid intent')];
    }
    if (ONLINE_ONLY_INTENTS.has(intent)) {
      return [badRequest(`Intent '${intent}' requires online verification`)];
    }

    const patient = await resolvePatientByHandle(ctx.repo, params.handle);
    if (!patient) {
      return [badRequest('Unknown QR handle')];
    }

    // Recompute the TOTP secret exactly like the client: base64-decoded offlineSecret bytes
    // concatenated with the UTF-8 bytes of `:${intent}` (see totpOffline.ts).
    const secretBytes = Buffer.concat([
      Buffer.from(deriveOfflineSecret(key, patient.id as string), 'base64'),
      Buffer.from(`:${intent}`, 'utf8'),
    ]);

    // Match the code against SERVER-derived steps only (current ±1 for clock skew) — the
    // client-claimed step is never trusted for validity.
    const serverStep = Math.floor(Date.now() / (QR_TOTP_STEP_SEC * 1000));
    const matchedSteps = matchOfflineCodeSteps(secretBytes, params.code, serverStep);
    if (matchedSteps.length === 0) {
      return [badRequest('Invalid offline code')];
    }

    // Burn every matched (handle,intent,serverStep) tuple so the same code cannot be redeemed
    // again anywhere in the ±1 acceptance window.
    let fresh = true;
    for (const step of matchedSteps) {
      if (!(await burnNonce(ctx.repo, `${params.handle}:${intent}:${step}`))) {
        fresh = false;
      }
    }
    if (!fresh) {
      return [badRequest('Offline code already used')];
    }

    const out = await executeIntent(ctx.repo, patient, intent as QrIntent);
    return [allOk, { resourceType: 'Parameters', parameter: out }];
  }

  return [badRequest('Provide either `token`, or `handle`+`intent`+`code`')];
}
