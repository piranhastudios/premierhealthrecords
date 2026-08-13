import { ClientStorage, type IClientStorage } from '@medplum/core';
import * as SecureStore from 'expo-secure-store';

/**
 * Token storage backed by the device keychain (iOS) / keystore (Android) via
 * expo-secure-store.
 *
 * The challenge: `IClientStorage` is SYNCHRONOUS (getString/setString) but
 * SecureStore is async. We resolve this with an in-memory mirror that is loaded
 * once on startup (exposed through `getInitPromise()`, which MedplumClient awaits
 * before first use). Sync reads hit the mirror; sync writes update the mirror and
 * fire-and-forget the SecureStore write.
 *
 * SecureStore cannot enumerate keys, so we persist an index of written keys under
 * `__keys__` and reload them on launch.
 */
const INDEX_KEY = '__keys__';
// SecureStore warns (and a future SDK will throw) above 2048 bytes. The Medplum
// active login (two JWTs + profile) exceeds that, so large values are split into
// chunks stored under `<key>.__c<i>` with a `<key>.__parts` count. 900 chars keeps
// each chunk well under 2048 bytes even if every character were 2-byte UTF-8 (the
// realistic worst case — accented names). Small values keep the plain single-key
// layout (backward compatible with logins written before chunking).
const CHUNK_SIZE = 900;
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** SecureStore keys must match /^[A-Za-z0-9._-]+$/. */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

class SecureMirror implements Storage {
  private readonly mirror = new Map<string, string>();
  private readonly keys = new Set<string>();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const indexRaw = await SecureStore.getItemAsync(safeKey(INDEX_KEY), STORE_OPTS);
      const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      for (const key of index) {
        const value = await this.read(key);
        if (value != null) {
          this.mirror.set(key, value);
          this.keys.add(key);
        }
      }
    } catch {
      // First run / corrupt index — start empty.
    }
  }

  get length(): number {
    return this.mirror.size;
  }

  key(index: number): string | null {
    return Array.from(this.mirror.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.mirror.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.mirror.set(key, value);
    if (!this.keys.has(key)) {
      this.keys.add(key);
      void this.persistIndex();
    }
    void this.persist(key, value);
  }

  removeItem(key: string): void {
    this.mirror.delete(key);
    if (this.keys.delete(key)) {
      void this.persistIndex();
    }
    void this.purge(key);
  }

  clear(): void {
    for (const key of this.keys) {
      void this.purge(key);
    }
    this.mirror.clear();
    this.keys.clear();
    void SecureStore.deleteItemAsync(safeKey(INDEX_KEY), STORE_OPTS);
  }

  private async persistIndex(): Promise<void> {
    try {
      await SecureStore.setItemAsync(safeKey(INDEX_KEY), JSON.stringify([...this.keys]), STORE_OPTS);
    } catch {
      // best effort
    }
  }

  /** Persist a value, chunking when it would exceed the SecureStore size limit. */
  private async persist(key: string, value: string): Promise<void> {
    const oldParts = Number((await SecureStore.getItemAsync(safeKey(`${key}.__parts`), STORE_OPTS)) ?? 0);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(safeKey(key), value, STORE_OPTS);
      // Drop any stale chunk representation from a previously larger value.
      for (let i = 0; i < oldParts; i++) {
        await SecureStore.deleteItemAsync(safeKey(`${key}.__c${i}`), STORE_OPTS);
      }
      if (oldParts > 0) {
        await SecureStore.deleteItemAsync(safeKey(`${key}.__parts`), STORE_OPTS);
      }
      return;
    }
    const parts = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < parts; i++) {
      await SecureStore.setItemAsync(safeKey(`${key}.__c${i}`), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), STORE_OPTS);
    }
    for (let i = parts; i < oldParts; i++) {
      await SecureStore.deleteItemAsync(safeKey(`${key}.__c${i}`), STORE_OPTS);
    }
    await SecureStore.setItemAsync(safeKey(`${key}.__parts`), String(parts), STORE_OPTS);
    // Remove any legacy single-key value now superseded by chunks.
    await SecureStore.deleteItemAsync(safeKey(key), STORE_OPTS);
  }

  /** Read a value, reassembling chunks when present; falls back to the plain key. */
  private async read(key: string): Promise<string | null> {
    const partsRaw = await SecureStore.getItemAsync(safeKey(`${key}.__parts`), STORE_OPTS);
    if (partsRaw) {
      const parts = Number(partsRaw);
      let out = '';
      for (let i = 0; i < parts; i++) {
        const chunk = await SecureStore.getItemAsync(safeKey(`${key}.__c${i}`), STORE_OPTS);
        if (chunk == null) {
          return null; // partial/corrupt — treat as missing
        }
        out += chunk;
      }
      return out;
    }
    return SecureStore.getItemAsync(safeKey(key), STORE_OPTS);
  }

  /** Delete a value and any chunk representation. */
  private async purge(key: string): Promise<void> {
    const partsRaw = await SecureStore.getItemAsync(safeKey(`${key}.__parts`), STORE_OPTS);
    if (partsRaw) {
      const parts = Number(partsRaw);
      for (let i = 0; i < parts; i++) {
        await SecureStore.deleteItemAsync(safeKey(`${key}.__c${i}`), STORE_OPTS);
      }
      await SecureStore.deleteItemAsync(safeKey(`${key}.__parts`), STORE_OPTS);
    }
    await SecureStore.deleteItemAsync(safeKey(key), STORE_OPTS);
  }
}

export class ExpoSecureClientStorage extends ClientStorage implements IClientStorage {
  private readonly secure: SecureMirror;

  constructor() {
    const secure = new SecureMirror();
    super(secure, 'phc.');
    this.secure = secure;
  }

  getInitPromise(): Promise<void> {
    return this.secure.ready;
  }
}
