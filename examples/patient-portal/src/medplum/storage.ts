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
        const value = await SecureStore.getItemAsync(safeKey(key), STORE_OPTS);
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
    void SecureStore.setItemAsync(safeKey(key), value, STORE_OPTS);
  }

  removeItem(key: string): void {
    this.mirror.delete(key);
    if (this.keys.delete(key)) {
      void this.persistIndex();
    }
    void SecureStore.deleteItemAsync(safeKey(key), STORE_OPTS);
  }

  clear(): void {
    for (const key of this.keys) {
      void SecureStore.deleteItemAsync(safeKey(key), STORE_OPTS);
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
