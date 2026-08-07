import type { Invoice, Patient } from '@medplum/fhirtypes';
import { patientCni, patientMrn, patientName } from '../lib/format';
import type { SummarySection } from '../lib/constants';
import { getDb, withTransaction } from './db';

export interface OutboxItem {
  id: string;
  kind: 'book' | 'message' | 'profile-edit';
  payload: unknown;
  idempotencyKey: string;
}

interface JsonRow {
  json: string;
}

function parseRows<T>(rows: JsonRow[]): T[] {
  return rows.map((r) => JSON.parse(r.json) as T);
}

// --- Profiles --------------------------------------------------------------------
export async function upsertProfiles(patients: Patient[], holderId?: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await withTransaction(async () => {
    for (const p of patients) {
      await db.runAsync(
        `INSERT OR REPLACE INTO profile (patient_id, display_name, cni, birth_date, is_self, json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id ?? '',
          patientName(p),
          patientCni(p) ?? null,
          p.birthDate ?? null,
          p.id === holderId ? 1 : 0,
          JSON.stringify(p),
          now,
        ]
      );
    }
  });
}

export async function getCachedProfiles(): Promise<Patient[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JsonRow>('SELECT json FROM profile ORDER BY is_self DESC, display_name');
  return parseRows<Patient>(rows);
}

// --- Curated summary (IPS) -------------------------------------------------------
export async function replaceSummary(
  patientId: string,
  entries: { section: SummarySection; resourceType: string; resourceId: string; effective?: string; resource: unknown }[]
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await withTransaction(async () => {
    await db.runAsync('DELETE FROM summary_entry WHERE patient_id = ?', [patientId]);
    for (const e of entries) {
      await db.runAsync(
        `INSERT OR REPLACE INTO summary_entry
         (patient_id, section, resource_type, resource_id, effective, json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [patientId, e.section, e.resourceType, e.resourceId, e.effective ?? null, JSON.stringify(e.resource), now]
      );
    }
  });
}

export async function getSummarySection<T>(patientId: string, section: SummarySection): Promise<T[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JsonRow>(
    'SELECT json FROM summary_entry WHERE patient_id = ? AND section = ? ORDER BY effective DESC',
    [patientId, section]
  );
  return parseRows<T>(rows);
}

export async function getSummaryCounts(patientId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ section: string; n: number }>(
    'SELECT section, COUNT(*) as n FROM summary_entry WHERE patient_id = ? GROUP BY section',
    [patientId]
  );
  return Object.fromEntries(rows.map((r) => [r.section, r.n]));
}

// --- Invoices --------------------------------------------------------------------
export async function upsertInvoices(invoices: Invoice[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await withTransaction(async () => {
    for (const inv of invoices) {
      const total = inv.totalGross ?? inv.totalNet;
      await db.runAsync(
        `INSERT OR REPLACE INTO invoice (invoice_id, patient_id, status, total_value, total_currency, date, json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inv.id ?? '',
          inv.subject?.reference?.replace('Patient/', '') ?? null,
          inv.status ?? null,
          total?.value ?? null,
          total?.currency ?? null,
          inv.date ?? null,
          JSON.stringify(inv),
          now,
        ]
      );
    }
  });
}

export async function getCachedInvoices(patientId: string): Promise<Invoice[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<JsonRow>(
    'SELECT json FROM invoice WHERE patient_id = ? ORDER BY date DESC',
    [patientId]
  );
  return parseRows<Invoice>(rows);
}

// --- Outbox ----------------------------------------------------------------------
export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO outbox (id, kind, payload, created_at, attempts, status, idempotency_key)
     VALUES (?, ?, ?, ?, 0, 'pending', ?)`,
    [item.id, item.kind, JSON.stringify(item.payload), new Date().toISOString(), item.idempotencyKey]
  );
}

export async function getPendingOutbox(): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; kind: OutboxItem['kind']; payload: string; idempotency_key: string }>(
    "SELECT id, kind, payload, idempotency_key FROM outbox WHERE status = 'pending' OR status = 'failed' ORDER BY created_at"
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    idempotencyKey: r.idempotency_key,
  }));
}

export async function markOutbox(id: string, status: 'done' | 'failed' | 'inflight', error?: string): Promise<void> {
  const db = await getDb();
  if (status === 'done') {
    await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
    return;
  }
  await db.runAsync('UPDATE outbox SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?', [
    status,
    error ?? null,
    id,
  ]);
}

// --- ID card ---------------------------------------------------------------------
export async function upsertIdCard(patient: Patient, qrMaterial?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO id_card (patient_id, full_name, cni, mrn, qr_material, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      patient.id ?? '',
      patientName(patient),
      patientCni(patient) ?? null,
      patientMrn(patient) ?? null,
      qrMaterial ?? null,
      JSON.stringify(patient),
      new Date().toISOString(),
    ]
  );
}

// --- Sync state ------------------------------------------------------------------
export async function getWatermark(patientId: string, resourceType: string): Promise<string | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_updated_watermark: string | null }>(
    'SELECT last_updated_watermark FROM sync_state WHERE patient_id = ? AND resource_type = ?',
    [patientId, resourceType]
  );
  return row?.last_updated_watermark ?? undefined;
}

export async function setWatermark(patientId: string, resourceType: string, watermark: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_state (patient_id, resource_type, last_updated_watermark, last_full_sync)
     VALUES (?, ?, ?, ?)`,
    [patientId, resourceType, watermark, new Date().toISOString()]
  );
}
