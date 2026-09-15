import type { DocumentReference, Patient } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import {
  DOCUMENT_TYPE_SYSTEM,
  IDENTITY_DOCUMENT_CODE,
  IDENTITY_DOCUMENT_TYPE_TOKEN,
  IDENTITY_RETENTION_DAYS,
} from '../../../../shared/identity-document';

/**
 * Identity documents uploaded for verification.
 *
 * These are photographs of a CNI, passport or residence permit. They exist only
 * so a member of staff can confirm the person is who they say they are, and are
 * deleted after {@link IDENTITY_RETENTION_DAYS} days by the
 * `purge-identity-documents` bot.
 *
 * The codes and the retention period come from shared/identity-document.ts,
 * which that bot imports too. The app states the retention period to patients
 * and the bot enforces it, so the two must never disagree.
 */
export { DOCUMENT_TYPE_SYSTEM, IDENTITY_DOCUMENT_CODE, IDENTITY_RETENTION_DAYS };

/** Where the app looks to decide what to tell the patient. */
export type VerificationState = 'none' | 'pending' | 'verified' | 'rejected';

/**
 * Reads verification state from the document itself rather than a flag on the
 * Patient, so there is one source of truth and no way for the two to disagree.
 * @param doc - The most recent identity document, if any.
 * @returns What to show the patient.
 */
export function verificationStateOf(doc?: DocumentReference): VerificationState {
  if (!doc) {
    return 'none';
  }
  if (doc.docStatus === 'final') {
    return 'verified';
  }
  if (doc.status === 'entered-in-error') {
    return 'rejected';
  }
  return 'pending';
}

/** The patient's most recent identity document, newest first. */
export async function latestIdentityDocument(
  medplum: MedplumClient,
  patientId: string
): Promise<DocumentReference | undefined> {
  const results = await medplum.searchResources(
    'DocumentReference',
    `subject=Patient/${patientId}&type=${IDENTITY_DOCUMENT_TYPE_TOKEN}&_sort=-date&_count=1`
  );
  return results[0];
}

/**
 * Uploads a photograph of an identity document and records it for review.
 *
 * `date` is set explicitly and never updated afterwards: the purge bot selects
 * on it, so using `_lastUpdated` instead would silently extend retention every
 * time a reviewer touched the record.
 * @param medplum - Authenticated client.
 * @param patient - The patient the document belongs to.
 * @param file - Local URI of the photograph, plus its mime type.
 * @returns The created DocumentReference.
 */
export async function uploadIdentityDocument(
  medplum: MedplumClient,
  patient: Patient,
  file: { uri: string; mimeType?: string }
): Promise<DocumentReference> {
  const contentType = file.mimeType ?? 'image/jpeg';
  // React Native has no File; fetching the local URI yields a Blob, which is
  // what createAttachment accepts.
  const blob = await fetch(file.uri).then((r) => r.blob());
  const attachment = await medplum.createAttachment({
    data: blob,
    contentType,
    filename: `identity-${patient.id}.jpg`,
  });

  const uploadedAt = new Date().toISOString();
  return medplum.createResource<DocumentReference>({
    resourceType: 'DocumentReference',
    status: 'current',
    // preliminary until a member of staff has actually looked at it.
    docStatus: 'preliminary',
    type: {
      coding: [{ system: DOCUMENT_TYPE_SYSTEM, code: IDENTITY_DOCUMENT_CODE, display: 'Identity document' }],
      text: 'Identity document',
    },
    subject: { reference: `Patient/${patient.id}` },
    date: uploadedAt,
    description: `Identity document for verification. Delete after ${IDENTITY_RETENTION_DAYS} days.`,
    content: [{ attachment }],
  });
}
