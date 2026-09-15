// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { vi } from 'vitest';
import { ClientStorage } from './storage';
import { MedplumClient } from './client';
import { createFakeJwt, mockFetch } from './client-test-utils';

/**
 * `offlineSessionCache` exists so an app can present a signed-in user with no
 * connectivity. `auth/me` is otherwise the only source of the profile, so an
 * offline launch has no profile, renders no signed-in UI, and is
 * indistinguishable from being logged out.
 */

const PROFILE_REF = 'Patient/p1';

function login(expiresInSeconds = 3600): Record<string, unknown> {
  return {
    accessToken: createFakeJwt({ login_id: 'l1', exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
    refreshToken: createFakeJwt({ login_id: 'l1' }),
    profile: { reference: PROFILE_REF, display: 'Test Patient' },
    project: { reference: 'Project/proj1' },
  };
}

const SESSION = {
  profile: { resourceType: 'Patient', id: 'p1', name: [{ given: ['Test'], family: 'Patient' }] },
  project: { resourceType: 'Project', id: 'proj1' },
  membership: { resourceType: 'ProjectMembership', id: 'm1' },
  config: { resourceType: 'UserConfiguration', id: 'c1' },
};

/** In-memory Storage with the async init hook a mobile keychain would use. */
class MemoryStorage implements Storage {
  private readonly data: Map<string, string>;
  constructor(seed: [string, string][] = []) {
    this.data = new Map(seed);
  }
  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null;
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

class AsyncClientStorage extends ClientStorage {
  readonly memory: MemoryStorage;
  constructor(memory: MemoryStorage) {
    super(memory);
    this.memory = memory;
  }
  getInitPromise(): Promise<void> {
    return Promise.resolve();
  }
}

function storageWithLogin(expiresInSeconds?: number): AsyncClientStorage {
  return new AsyncClientStorage(new MemoryStorage([['activeLogin', JSON.stringify(login(expiresInSeconds))]]));
}

/** A fetch that never reaches the server, like a device in airplane mode. */
const offlineFetch = vi.fn(() => Promise.reject(new TypeError('Network request failed')));

describe('offlineSessionCache', () => {
  test('caches the session on a successful refresh', async () => {
    const storage = storageWithLogin();
    const medplum = new MedplumClient({
      fetch: mockFetch(200, SESSION),
      storage,
      offlineSessionCache: true,
    });
    await medplum.getInitPromise();
    await medplum.getProfileAsync();

    expect(medplum.getProfile()?.id).toStrictEqual('p1');
    expect(storage.memory.getItem('sessionDetails')).toBeTruthy();
  });

  test('restores the profile when the server cannot be reached', async () => {
    const storage = new AsyncClientStorage(
      new MemoryStorage([
        ['activeLogin', JSON.stringify(login())],
        ['sessionDetails', JSON.stringify(SESSION)],
      ])
    );
    const medplum = new MedplumClient({ fetch: offlineFetch, storage, offlineSessionCache: true });
    await medplum.getInitPromise();

    await expect(medplum.getProfileAsync()).resolves.toMatchObject({ id: 'p1' });
    expect(medplum.getProfile()?.id).toStrictEqual('p1');
    // The login must survive so a new access token can be fetched once there is
    // signal again.
    expect(medplum.getActiveLogin()).toBeDefined();
  });

  test('restores the profile even when the access token has expired', async () => {
    // The realistic case: the app is opened days later, still with no signal.
    const storage = new AsyncClientStorage(
      new MemoryStorage([
        ['activeLogin', JSON.stringify(login(-7200))],
        ['sessionDetails', JSON.stringify(SESSION)],
      ])
    );
    const medplum = new MedplumClient({ fetch: offlineFetch, storage, offlineSessionCache: true });
    await medplum.getInitPromise();

    await expect(medplum.getProfileAsync()).resolves.toMatchObject({ id: 'p1' });
    expect(medplum.getActiveLogin()).toBeDefined();
  });

  test('does NOT restore when the server rejects the token', async () => {
    // A 401 means the server answered. An expired or revoked session must still
    // sign the user out rather than resurrect a cached profile.
    const storage = new AsyncClientStorage(
      new MemoryStorage([
        ['activeLogin', JSON.stringify(login())],
        ['sessionDetails', JSON.stringify(SESSION)],
      ])
    );
    const medplum = new MedplumClient({
      fetch: mockFetch(401, {
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'login', details: { text: 'Invalid token' } }],
      }),
      storage,
      offlineSessionCache: true,
    });
    await medplum.getInitPromise();

    await expect(medplum.getProfileAsync()).rejects.toThrow();
    expect(medplum.getProfile()).toBeUndefined();
  });

  test('ignores a cached session belonging to a different user', async () => {
    const storage = new AsyncClientStorage(
      new MemoryStorage([
        ['activeLogin', JSON.stringify(login())],
        // Cache left behind by someone else — must never be shown.
        ['sessionDetails', JSON.stringify({ ...SESSION, profile: { resourceType: 'Patient', id: 'someone-else' } })],
      ])
    );
    const medplum = new MedplumClient({ fetch: offlineFetch, storage, offlineSessionCache: true });
    await medplum.getInitPromise();

    await expect(medplum.getProfileAsync()).rejects.toThrow();
    expect(medplum.getProfile()).toBeUndefined();
  });

  test('is off by default', async () => {
    const storage = new AsyncClientStorage(
      new MemoryStorage([
        ['activeLogin', JSON.stringify(login())],
        ['sessionDetails', JSON.stringify(SESSION)],
      ])
    );
    const medplum = new MedplumClient({ fetch: offlineFetch, storage });
    await medplum.getInitPromise();

    await expect(medplum.getProfileAsync()).rejects.toThrow();
    expect(medplum.getProfile()).toBeUndefined();
  });

  test('clears the cached session on sign out', async () => {
    const storage = storageWithLogin();
    const medplum = new MedplumClient({
      fetch: mockFetch(200, SESSION),
      storage,
      offlineSessionCache: true,
    });
    await medplum.getInitPromise();
    await medplum.getProfileAsync();
    expect(storage.memory.getItem('sessionDetails')).toBeTruthy();

    medplum.clearActiveLogin();

    // Nothing about the patient may stay on a signed-out device.
    expect(storage.memory.getItem('sessionDetails')).toBeNull();
  });
});
