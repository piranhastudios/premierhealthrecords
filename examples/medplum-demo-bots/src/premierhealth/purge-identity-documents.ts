// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Identity document retention bot (cron, daily — see scripts/seed-subscriptions.mjs).
 *
 * Patients photograph a CNI, passport or residence permit so a member of staff
 * can confirm who they are. Premier Health commits to holding those photographs
 * for 30 DAYS AND THEN DELETING THEM. This bot is that promise: without it the
 * app's retention notice would be false and identity documents would accumulate
 * indefinitely.
 *
 * Each run deletes every identity DocumentReference whose `date` is older than
 * the retention window, together with the Binary holding the actual image —
 * removing only the DocumentReference would leave the photograph on disk.
 *
 * Selection uses `date`, not `_lastUpdated`: `date` is stamped once at upload
 * and never changed, whereas `_lastUpdated` moves every time a reviewer touches
 * the record, which would silently extend retention for exactly the documents
 * staff had looked at.
 *
 * Verification outcome is NOT lost when the image goes: it lives on the
 * DocumentReference's docStatus, which is copied onto the patient before
 * deletion, so a verified patient stays verified with no document retained.
 *
 * Idempotent: a document already deleted simply does not come back in the
 * search, so re-running is harmless.
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { DocumentReference, Patient } from '@medplum/fhirtypes';

const PHC_FHIR = 'https://premierhealth.cm/fhir';

// Duplicated in the patient portal (src/lib/identityDocument.ts) because the app
// and the bots are separate deployables with no shared package. If these drift,
// this bot silently matches nothing and documents are kept for ever.
const DOCUMENT_TYPE_SYSTEM = `${PHC_FHIR}/CodeSystem/document-type`;
const IDENTITY_DOCUMENT_CODE = 'identity-document';

/** Marks a patient whose identity a member of staff confirmed. */
const IDENTITY_VERIFIED_EXTENSION = `${PHC_FHIR}/StructureDefinition/identity-verified`;

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `Binary/abc-123` or a storage URL ending in the id — we need the id. */
export function binaryIdFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = /Binary\/([A-Za-z0-9-.]+)/.exec(url);
  return match?.[1];
}

/**
 * Copies the verification outcome onto the patient so it survives the document.
 * @param medplum - The client.
 * @param doc - The document about to be deleted.
 */
async function preserveOutcome(medplum: MedplumClient, doc: DocumentReference): Promise<void> {
  if (doc.docStatus !== 'final') {
    return; // Only a completed check is worth keeping.
  }
  const patientRef = doc.subject?.reference;
  if (!patientRef?.startsWith('Patient/')) {
    return;
  }
  const patient = await medplum.readReference<Patient>({ reference: patientRef } as never);
  const already = patient.extension?.some((e) => e.url === IDENTITY_VERIFIED_EXTENSION);
  if (already) {
    return;
  }
  await medplum.updateResource<Patient>({
    ...patient,
    extension: [
      ...(patient.extension ?? []),
      { url: IDENTITY_VERIFIED_EXTENSION, valueDateTime: doc.date ?? new Date().toISOString() },
    ],
  });
}

export async function handler(medplum: MedplumClient, _event: BotEvent): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString();

  const expired = await medplum.searchResources(
    'DocumentReference',
    `type=${DOCUMENT_TYPE_SYSTEM}|${IDENTITY_DOCUMENT_CODE}&date=lt${cutoff}&_count=200`
  );

  let deleted = 0;
  for (const doc of expired) {
    try {
      await preserveOutcome(medplum, doc);

      // Delete the image first. If this run dies midway the DocumentReference
      // survives and is picked up again next time; deleting it first would
      // orphan the Binary with nothing left pointing at it.
      for (const content of doc.content ?? []) {
        const binaryId = binaryIdFromUrl(content.attachment?.url);
        if (binaryId) {
          await medplum.deleteResource('Binary', binaryId);
        }
      }

      if (doc.id) {
        await medplum.deleteResource('DocumentReference', doc.id);
        deleted++;
      }
    } catch (err) {
      // One bad document must not stop the rest of the purge — that would turn
      // a single failure into indefinite retention for everyone behind it.
      console.error(`Failed to purge DocumentReference/${doc.id}:`, (err as Error).message);
    }
  }

  console.log(`Identity document purge: ${deleted} of ${expired.length} expired documents deleted.`);
  return { deleted };
}
