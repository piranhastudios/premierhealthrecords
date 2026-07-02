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
    });
  }
  return singleton;
}
