import { useMedplum } from '@medplum/react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { QR_ROTATE_MS } from '../lib/constants';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getEnrollment } from './enrollment';
import { issueOnlineQr } from './issueOnline';
import { offlineQr } from './totpOffline';
import { QR_INTENTS, type QrIntent, type QrPayload } from './types';

export interface RotatingQrState {
  payload?: QrPayload;
  loading: boolean;
  error?: string;
  online: boolean;
  rotate: () => Promise<void>;
}

/**
 * Produces a rotating QR payload for the given patient + intent. Picks the online
 * server-signed JWS when connected; falls back to the offline TOTP code for
 * low-risk intents; refuses pay/grant offline. Re-generates every QR_ROTATE_MS.
 */
export function useRotatingQr(patientId: string | undefined, intent: QrIntent, context?: string): RotatingQrState {
  const medplum = useMedplum();
  const { online } = useNetworkStatus();
  const [payload, setPayload] = useState<QrPayload>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const rotate = useCallback(async () => {
    if (!patientId) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      if (online) {
        setPayload(await issueOnlineQr(medplum, patientId, intent, context));
      } else if (!QR_INTENTS[intent].onlineOnly) {
        const enrollment = await getEnrollment(medplum, patientId);
        if (!enrollment) {
          throw new Error('Offline code unavailable. Connect once to enable it.');
        }
        setPayload(await offlineQr(enrollment, intent));
      } else {
        throw new Error('Connect to the internet to use this.');
      }
    } catch (err) {
      setPayload(undefined);
      setError(err instanceof Error ? err.message : 'Could not generate code.');
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId, intent, context, online]);

  useEffect(() => {
    void rotate();
  }, [rotate]);

  useEffect(() => {
    const id = setInterval(() => void rotate(), QR_ROTATE_MS);
    return () => clearInterval(id);
  }, [rotate]);

  return { payload, loading, error, online, rotate };
}
