// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Center, Loader, Modal, Stack, Text } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import classes from './PatientQrScanner.module.css';

// Minimal typings for the browser BarcodeDetector API (no @types ship for it).
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export interface PatientQrScannerProps {
  opened: boolean;
  onClose: () => void;
}

type ScanStatus = 'scanning' | 'verifying' | 'error' | 'unsupported';

type ParsedQr = { token: string } | { handle: string; intent: string; code: string };

/**
 * Parses a scanned Premier Health patient QR value (`phc://q?...`) into the
 * inputs for the `Patient/$verify-qr` operation. Returns null for anything else.
 * @param text - The decoded QR string.
 * @returns The verify-qr inputs, or null if not a PHC patient QR.
 */
function parseQr(text: string): ParsedQr | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'phc:') {
    return null;
  }
  const mode = url.searchParams.get('m');
  if (mode === 'jws') {
    const token = url.searchParams.get('j');
    return token ? { token } : null;
  }
  if (mode === 'totp') {
    const handle = url.searchParams.get('h');
    const intent = url.searchParams.get('i');
    const code = url.searchParams.get('c');
    return handle && intent && code ? { handle, intent, code } : null;
  }
  return null;
}

/**
 * Maps the server's verify-qr error into an actionable message for staff.
 * @param raw - The normalized server error string.
 * @returns A staff-friendly explanation.
 */
function friendlyVerifyError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('signature') || s.includes('invalid token')) {
    return 'This code could not be verified. Ask the patient to refresh their QR code, and check that the patient app and this app are connected to the same Premier Health server.';
  }
  if (s.includes('expired')) {
    return 'This QR code has expired. Ask the patient to show a fresh one.';
  }
  if (s.includes('already used')) {
    return 'This QR code was already used. Ask the patient to generate a new one.';
  }
  if (s.includes('unknown qr handle')) {
    return 'This patient has not set up their QR code yet.';
  }
  if (s.includes('forbidden')) {
    return 'You do not have permission to verify patient QR codes.';
  }
  return raw || 'Could not verify the QR code.';
}

/**
 * Modal that scans a patient's QR code via the webcam and opens their chart.
 *
 * Decodes with the native BarcodeDetector API (Chromium), then verifies the
 * signed token server-side via the `Patient/$verify-qr` operation — the same
 * operation the patient app's QR is minted for — and navigates to the resolved
 * patient. No PHI is ever embedded in the QR; the server resolves it.
 *
 * @param props - Whether the modal is open and its close handler.
 * @returns The scanner modal.
 */
export function PatientQrScanner(props: PatientQrScannerProps): JSX.Element {
  const { opened, onClose } = props;
  const medplum = useMedplum();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScanStatus>('scanning');
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(undefined);
    setStatus('scanning');
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!opened) {
      return undefined;
    }

    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setStatus('unsupported');
      return undefined;
    }

    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const detector = new Ctor({ formats: ['qr_code'] });
    setStatus('scanning');
    setError(undefined);

    async function verify(value: string): Promise<void> {
      const parsed = parseQr(value);
      if (!parsed) {
        setStatus('error');
        setError('That QR code is not a Premier Health patient code.');
        return;
      }
      setStatus('verifying');
      const parameter =
        'token' in parsed
          ? [{ name: 'token', valueString: parsed.token }]
          : [
              { name: 'handle', valueString: parsed.handle },
              { name: 'intent', valueString: parsed.intent },
              { name: 'code', valueString: parsed.code },
            ];
      try {
        const result: Parameters = await medplum.post(medplum.fhirUrl('Patient', '$verify-qr'), {
          resourceType: 'Parameters',
          parameter,
        });
        const ref = result.parameter?.find((p) => p.name === 'patient')?.valueReference?.reference;
        if (!ref) {
          throw new Error('The QR code did not resolve to a patient.');
        }
        onClose();
        navigate(`/${ref}`)?.catch(() => undefined);
      } catch (err) {
        setStatus('error');
        setError(friendlyVerifyError(normalizeErrorString(err)));
      }
    }

    async function start(): Promise<void> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          return;
        }
        video.srcObject = stream;
        await video.play();
        timer = setInterval(() => {
          const el = videoRef.current;
          if (cancelled || !el || el.readyState < 2) {
            return;
          }
          detector
            .detect(el)
            .then((codes) => {
              if (!cancelled && codes.length > 0 && timer) {
                clearInterval(timer);
                timer = undefined;
                verify(codes[0].rawValue).catch(() => undefined);
              }
            })
            .catch(() => undefined); // ignore transient per-frame decode errors
        }, 300);
      } catch {
        if (!cancelled) {
          setStatus('error');
          setError('Could not access the camera. Please allow camera access and try again.');
        }
      }
    }

    start().catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [opened, attempt, medplum, navigate, onClose]);

  return (
    <Modal opened={opened} onClose={onClose} title="Scan patient QR" centered size="md">
      <Stack gap="md">
        {status === 'unsupported' ? (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Scanning not supported">
            QR scanning needs a Chromium-based browser (Google Chrome or Microsoft Edge). Please open the provider app
            there to scan patient codes.
          </Alert>
        ) : (
          <>
            <div className={classes.viewport}>
              <video ref={videoRef} className={classes.video} playsInline muted />
              <div className={classes.frame} aria-hidden />
              {status === 'verifying' && (
                <Center className={classes.overlay}>
                  <Loader color="white" />
                </Center>
              )}
            </div>
            <Text size="sm" c="dimmed" ta="center">
              {status === 'verifying'
                ? 'Verifying code…'
                : 'Point the camera at the patient’s QR code in the Premier Health app.'}
            </Text>
          </>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Scan failed">
            {error}
          </Alert>
        )}

        {status === 'error' && (
          <Button onClick={retry} variant="light">
            Try again
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
