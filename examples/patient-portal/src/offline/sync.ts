import type { MedplumClient } from '@medplum/core';
import type {
  Appointment,
  Communication,
  Invoice,
  Observation,
  Patient,
  Resource,
} from '@medplum/fhirtypes';
import type { SummarySection } from '../lib/constants';
import { DEFAULT_CURRENCY } from '../lib/constants';
import {
  enqueueOutbox,
  getPendingOutbox,
  markOutbox,
  replaceSummary,
  upsertIdCard,
  upsertInvoices,
  upsertProfiles,
  type OutboxItem,
} from './repositories';

/** Map an IPS resource into one of the curated summary sections (or skip it). */
function sectionFor(resource: Resource): SummarySection | undefined {
  switch (resource.resourceType) {
    case 'AllergyIntolerance':
      return 'allergy';
    case 'MedicationRequest':
    case 'MedicationStatement':
    case 'MedicationDispense':
    case 'Medication':
      return 'medication';
    case 'Condition':
      return 'condition';
    case 'Immunization':
      return 'immunization';
    case 'Observation':
      return (resource as Observation).category?.some((c) =>
        c.coding?.some((code) => code.code === 'laboratory')
      )
        ? 'lab'
        : undefined;
    case 'Encounter':
      return 'encounter';
    default:
      return undefined;
  }
}

function effectiveOf(resource: Resource): string | undefined {
  const r = resource as unknown as Record<string, unknown>;
  return (
    (r.effectiveDateTime as string) ??
    (r.recordedDate as string) ??
    (r.onsetDateTime as string) ??
    (r.occurrenceDateTime as string) ??
    ((r.period as { start?: string })?.start) ??
    (r.date as string) ??
    (resource.meta?.lastUpdated as string)
  );
}

/**
 * Pull the curated International Patient Summary + invoices for one patient and
 * persist them to the encrypted cache. Clinical data is server-wins: we replace
 * the local copy wholesale on every sync.
 */
export async function syncPatient(medplum: MedplumClient, patient: Patient): Promise<void> {
  const patientId = patient.id;
  if (!patientId) {
    return;
  }

  // 1. IPS summary → curated sections.
  try {
    const bundle = await medplum.readPatientSummary(patientId);
    const entries = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => Boolean(r?.id))
      .map((r) => {
        const section = sectionFor(r);
        return section
          ? { section, resourceType: r.resourceType, resourceId: r.id as string, effective: effectiveOf(r), resource: r }
          : undefined;
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    await replaceSummary(patientId, entries);
  } catch {
    // Offline or summary unavailable — keep the last cached copy.
  }

  // 2. Invoices.
  try {
    const invoices = await medplum.searchResources('Invoice', `subject=Patient/${patientId}&_sort=-_lastUpdated&_count=50`);
    await upsertInvoices(invoices as Invoice[]);
  } catch {
    // keep cache
  }

  // 3. Refresh the ID-card snapshot.
  await upsertIdCard(patient);
}

/** Sync the holder + all managed dependents. */
export async function syncAll(medplum: MedplumClient, holderId: string | undefined, profiles: Patient[]): Promise<void> {
  await upsertProfiles(profiles, holderId);
  for (const p of profiles) {
    await syncPatient(medplum, p);
  }
}

/** Replay queued offline writes. Idempotency keys (also written as a FHIR
 *  identifier) protect against double-submission after flaky networks. */
export async function drainOutbox(medplum: MedplumClient): Promise<void> {
  const pending = await getPendingOutbox();
  for (const item of pending) {
    try {
      await markOutbox(item.id, 'inflight');
      await processOutboxItem(medplum, item);
      await markOutbox(item.id, 'done');
    } catch (err) {
      await markOutbox(item.id, 'failed', err instanceof Error ? err.message : String(err));
    }
  }
}

async function processOutboxItem(medplum: MedplumClient, item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case 'book':
      await medplum.createResource(item.payload as Appointment);
      break;
    case 'message':
      await medplum.createResource(item.payload as Communication);
      break;
    case 'profile-edit':
      await medplum.updateResource(item.payload as Patient);
      break;
  }
}

/** Queue a booking request (works offline; drained on reconnect). */
export async function queueBooking(appointment: Appointment, idempotencyKey: string): Promise<void> {
  await enqueueOutbox({ id: idempotencyKey, kind: 'book', payload: appointment, idempotencyKey });
}

export { DEFAULT_CURRENCY };
