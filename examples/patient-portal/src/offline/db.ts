import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { bytesToBase64 } from '../lib/encoding';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

const DB_NAME = 'phc.db';
const DB_KEY_NAME = 'phc.db.key';

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

/** 256-bit DB key, generated once and kept in the device keychain/keystore. */
async function getDbKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(DB_KEY_NAME, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (!key) {
    key = bytesToBase64(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(DB_KEY_NAME, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return key;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await getDbKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // Encryption-at-rest: when the app is built against a SQLCipher-enabled
  // expo-sqlite (via a config plugin / custom build), `PRAGMA key` encrypts the
  // whole database with our keychain-held key. On a stock (non-SQLCipher) build
  // the pragma is a harmless no-op, so the same code path works in Expo Go for
  // development. See README "Encryption at rest".
  try {
    await db.execAsync(`PRAGMA key = '${key.replace(/'/g, "''")}';`);
  } catch {
    // Non-SQLCipher build — continue unencrypted (dev only).
  }

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.withTransactionAsync(async () => {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.execAsync(stmt);
    }
  });
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'schema_version',
    String(SCHEMA_VERSION),
  ]);
  return db;
}

/** Lazily-opened, process-wide encrypted database handle. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open();
  }
  return dbPromise;
}

// expo-sqlite's `withTransactionAsync` shares a single connection and is NOT safe
// to run concurrently: two overlapping transactions both issue BEGIN, so the
// second throws "cannot start a transaction within a transaction" (and its
// ROLLBACK then throws "no transaction is active"). Sync can fire more than once
// at a time (SyncProvider effects), so we serialize all write transactions
// through a promise queue — at most one transaction is ever open.
let txTail: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` inside a database transaction, serialized against every other
 * `withTransaction` call so transactions never overlap on the shared connection.
 * @param fn - Callback that performs the writes; the transaction commits when it
 *   resolves and rolls back if it throws.
 * @returns A promise that resolves once this transaction has committed.
 */
export async function withTransaction(fn: () => Promise<void>): Promise<void> {
  const db = await getDb();
  const run = txTail.then(() => db.withTransactionAsync(fn));
  // Keep the queue moving whether this transaction commits or rolls back.
  txTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
