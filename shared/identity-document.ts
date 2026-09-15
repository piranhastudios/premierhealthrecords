// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * The identity-document contract, shared by the patient portal and the bots.
 *
 * These two are separate deployables. When each kept its own copy of these
 * strings, a change to one meant the purge bot silently matched nothing and
 * identity documents were retained indefinitely — the failure was invisible
 * because everything still compiled and ran. One definition, imported by both,
 * removes that failure mode entirely.
 */

const PHC_FHIR = 'https://premierhealth.cm/fhir';

/** CodeSystem for Premier Health's own document classifications. */
export const DOCUMENT_TYPE_SYSTEM = `${PHC_FHIR}/CodeSystem/document-type`;

/** A photograph of a CNI, passport or residence permit, uploaded for checking. */
export const IDENTITY_DOCUMENT_CODE = 'identity-document';

/** Search token for finding identity documents. */
export const IDENTITY_DOCUMENT_TYPE_TOKEN = `${DOCUMENT_TYPE_SYSTEM}|${IDENTITY_DOCUMENT_CODE}`;

/** Stamped on a Patient once staff have confirmed their identity. */
export const IDENTITY_VERIFIED_EXTENSION = `${PHC_FHIR}/StructureDefinition/identity-verified`;

/**
 * How long an uploaded identity document may be kept.
 *
 * The app states this to the patient and the purge bot enforces it. They must
 * be the same number or the app is lying.
 */
export const IDENTITY_RETENTION_DAYS = 30;
