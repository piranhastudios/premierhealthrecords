// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Assign-patient-id bot.
 *
 * Triggered by a Subscription on `Patient` create. It assigns a recitable Medical
 * Record Number (MRN) to every newly created Patient so front-desk staff and patients
 * can say the number out loud.
 *
 * Format: `${registrationYear}-${birthYear}-${NNNN}` (e.g. `2026-1990-0001`), where:
 *  - registrationYear = the current year (year the record is created),
 *  - birthYear = the 4-digit year from `patient.birthDate`, or `0000` if absent,
 *  - NNNN = a 4-digit zero-padded sequence that increments per registration year.
 * The sequence overflows gracefully past 9999 (it just keeps counting digits).
 *
 * Sequences are reserved from a dedicated per-registration-year counter (a `Basic`
 * resource identified by `mrn-counter|<year>` that stores the last issued sequence in
 * an extension). The counter is created idempotently via conditional create
 * (`If-None-Exist`) and incremented under an optimistic lock (`If-Match` on its
 * version), so two concurrent registrations can never be issued the same sequence: the
 * loser gets an HTTP 409/412, re-reads the counter, and retries (up to 5 attempts with
 * a tiny backoff).
 *
 * The MRN is appended to `Patient.identifier` with a standard `MR` type coding; any
 * existing identifiers (e.g. the Cameroon national ID / CNI) are preserved. The bot is
 * idempotent: if the patient already carries an MRN identifier, it returns without
 * changes.
 *
 * A patient with no `birthDate` is skipped rather than stamped with a permanent
 * `0000` birth-year segment — the Subscription fires on updates too, so the MRN is
 * assigned as soon as the birth date is recorded.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Basic, Extension, Identifier, Patient } from '@medplum/fhirtypes';

// The MRN identifier system. Kept as a top-of-file constant so the format can be
// swapped to a compact `YY-YY-NNNN` scheme later without hunting through the code.
const MRN_SYSTEM = 'https://premierhealth.cm/fhir/sid/mrn';

// The per-registration-year MRN counter: a `Basic` resource whose identifier value is
// the registration year, with the last issued sequence stored in an extension.
const COUNTER_SYSTEM = 'https://premierhealth.cm/fhir/sid/mrn-counter';
const LAST_SEQUENCE_URL = 'https://premierhealth.cm/fhir/StructureDefinition/mrn-last-sequence';

// How the recitable value is assembled. Change these two helpers together to alter
// the scheme (e.g. two-digit years).
const SEQUENCE_PAD = 4;
const formatMrn = (regYear: number, birthYear: string, sequence: number): string =>
  `${regYear}-${birthYear}-${String(sequence).padStart(SEQUENCE_PAD, '0')}`;

// Standard identifier-type coding so downstream systems recognise the MRN as a
// Medical Record Number rather than an opaque local identifier.
const MRN_TYPE: Identifier['type'] = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical record number' }],
  text: 'MRN',
};

// Max attempts to increment the counter when another registration races us, with a
// small linear backoff between attempts.
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 25;

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Patient>
): Promise<Patient | { skipped: string }> {
  const input = event.input;

  // Idempotency: never assign a second MRN.
  if (input.identifier?.some((id) => id.system === MRN_SYSTEM)) {
    return { skipped: 'already-has-mrn' };
  }

  // The birth year is part of the MRN. Wait for it rather than permanently stamping
  // `0000`: the Subscription also fires on update, so the MRN is assigned as soon as
  // the birth date is recorded. (An empty-string birthDate counts as missing.)
  if (!input.birthDate) {
    return { skipped: 'no-birth-date' };
  }

  // Read-modify-write on the freshest copy so we never clobber existing identifiers,
  // and re-check idempotency before reserving a sequence.
  const current = await medplum.readResource('Patient', input.id as string);
  if (current.identifier?.some((id) => id.system === MRN_SYSTEM)) {
    return { skipped: 'already-has-mrn' };
  }

  const regYear = new Date().getFullYear();
  const sequence = await allocateSequence(medplum, regYear);
  const mrn: Identifier = {
    type: MRN_TYPE,
    system: MRN_SYSTEM,
    value: formatMrn(regYear, input.birthDate.slice(0, 4), sequence),
  };

  return medplum.updateResource<Patient>({
    ...current,
    identifier: [...(current.identifier ?? []), mrn],
  });
}

// Reserve the next per-registration-year sequence from the dedicated counter.
//
// The counter is read (or created idempotently via `If-None-Exist`, so concurrent
// registrations racing to create it converge on a single resource), then incremented
// with an `If-Match` precondition on its version. If another registration incremented
// the counter between our read and write, the server rejects the write with a
// 409/412 conflict and we re-read and retry.
async function allocateSequence(medplum: MedplumClient, regYear: number): Promise<number> {
  const year = String(regYear);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const counter = await medplum.createResourceIfNoneExist<Basic>(
      {
        resourceType: 'Basic',
        code: { coding: [{ system: COUNTER_SYSTEM, code: 'mrn-counter' }], text: `MRN counter ${year}` },
        identifier: [{ system: COUNTER_SYSTEM, value: year }],
        extension: [{ url: LAST_SEQUENCE_URL, valueInteger: 0 }],
      },
      `identifier=${COUNTER_SYSTEM}|${year}`
    );

    const next = lastSequence(counter) + 1;
    try {
      await medplum.updateResource(withLastSequence(counter, next), {
        headers: { 'If-Match': `W/"${counter.meta?.versionId}"` },
      });
      return next;
    } catch (err) {
      if (isConflict(err) && attempt < MAX_ATTEMPTS) {
        await sleep(attempt * BACKOFF_MS);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to reserve an MRN sequence after ${MAX_ATTEMPTS} attempts (counter write conflict)`);
}

function lastSequence(counter: Basic): number {
  return counter.extension?.find((e) => e.url === LAST_SEQUENCE_URL)?.valueInteger ?? 0;
}

function withLastSequence(counter: Basic, sequence: number): Basic {
  const ext: Extension = { url: LAST_SEQUENCE_URL, valueInteger: sequence };
  return {
    ...counter,
    extension: [...(counter.extension ?? []).filter((e) => e.url !== LAST_SEQUENCE_URL), ext],
  };
}

// Optimistic-locking failures surface as HTTP 409 (Conflict) or 412 (Precondition Failed).
function isConflict(err: unknown): boolean {
  const status = (err as { status?: number; outcome?: { status?: number } })?.status ?? undefined;
  const message = err instanceof Error ? err.message : String(err);
  return status === 409 || status === 412 || /\b(409|412|conflict|precondition)\b/i.test(message);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
