import { MedplumClient } from '@medplum/core';
import { config } from '../lib/config';
import { ExpoSecureClientStorage } from './storage';

let singleton: MedplumClient | undefined;

/** Single shared MedplumClient for the app (keychain-backed token storage). */
export function getMedplum(): MedplumClient {
  if (!singleton) {
    singleton = new MedplumClient({
      baseUrl: config.medplumBaseUrl,
      clientId: config.medplumClientId || undefined,
      storage: new ExpoSecureClientStorage(),
      // RN provides global fetch + WebSocket; cache + auto-batch keep the UI snappy.
      cacheTime: 60_000,
      autoBatchTime: 100,
      // Carrying your record into a place with no signal is the whole point of
      // this app. Without this, `auth/me` is the only source of the profile, so
      // an offline launch has no profile, renders no signed-in UI, and looks
      // exactly like being logged out. Safe to persist here because storage is
      // the device keychain/keystore (ExpoSecureClientStorage), and a token the
      // server actually rejects still signs the user out.
      offlineSessionCache: true,
    });
  }
  return singleton;
}
