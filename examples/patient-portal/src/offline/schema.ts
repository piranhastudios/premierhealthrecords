export const SCHEMA_VERSION = 1;

/** Curated offline cache — NOT a full FHIR mirror. Resources stored as JSON with
 *  a few extracted columns for filtering/sorting. See plan §A4. */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS profile (
    patient_id   TEXT PRIMARY KEY,
    display_name TEXT,
    cni          TEXT,
    birth_date   TEXT,
    is_self      INTEGER DEFAULT 0,
    json         TEXT NOT NULL,
    updated_at   TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS summary_entry (
    patient_id    TEXT NOT NULL,
    section       TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    effective     TEXT,
    json          TEXT NOT NULL,
    updated_at    TEXT,
    PRIMARY KEY (patient_id, resource_type, resource_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_summary_section ON summary_entry (patient_id, section, effective DESC);`,
  `CREATE TABLE IF NOT EXISTS invoice (
    invoice_id     TEXT PRIMARY KEY,
    patient_id     TEXT,
    status         TEXT,
    total_value    REAL,
    total_currency TEXT,
    date           TEXT,
    json           TEXT NOT NULL,
    updated_at     TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_patient ON invoice (patient_id, date DESC);`,
  `CREATE TABLE IF NOT EXISTS id_card (
    patient_id  TEXT PRIMARY KEY,
    full_name   TEXT,
    cni         TEXT,
    mrn         TEXT,
    qr_material TEXT,
    json        TEXT,
    updated_at  TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    payload         TEXT NOT NULL,
    created_at      TEXT,
    attempts        INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'pending',
    last_error      TEXT,
    idempotency_key TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    patient_id             TEXT NOT NULL,
    resource_type          TEXT NOT NULL,
    last_updated_watermark TEXT,
    last_full_sync         TEXT,
    PRIMARY KEY (patient_id, resource_type)
  );`,
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );`,
];
