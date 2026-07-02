import type { MedplumClient } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import * as SecureStore from 'expo-secure-store';
import type { QrEnrollment } from './types';

const ENROLL_PREFIX = 'phc.qr.';

function key(patientId: string): string {
  return `${ENROLL_PREFIX}${patientId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function paramString(params: Parameters | undefined, name: string): string | undefined {
  return params?.parameter?.find((p) => p.name === name)?.valueString;
}

/**
 * Returns the patient's QR enrollment material (opaque handle + offline secret),
 * fetching it from the server once and caching it in the keychain. Provisioned by
 * the server `Patient/$qr-enroll` operation. Returns undefined when offline and
 * uncached (the offline QR is then unavailable until the next online session).
 */
export async function getEnrollment(medplum: MedplumClient, patientId: string): Promise<QrEnrollment | undefined> {
  const cached = await SecureStore.getItemAsync(key(patientId), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (cached) {
    return JSON.parse(cached) as QrEnrollment;
  }

  try {
    const result = (await medplum.post(
      medplum.fhirUrl('Patient', patientId, '$qr-enroll'),
      { resourceType: 'Parameters', parameter: [] } as Parameters
    )) as Parameters;
    const handle = paramString(result, 'handle');
    const secret = paramString(result, 'secret');
    if (!handle || !secret) {
      return undefined;
    }
    const enrollment: QrEnrollment = { handle, secret };
    await SecureStore.setItemAsync(key(patientId), JSON.stringify(enrollment), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return enrollment;
  } catch {
    return undefined;
  }
}
