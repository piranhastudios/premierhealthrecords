import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

/**
 * Require a biometric (Face ID / fingerprint) before revealing the ID card's QR.
 * Falls back to "allow" only where no biometric hardware is enrolled (web / some
 * dev devices) so the feature remains usable in development.
 */
export async function requireBiometric(reason = 'Unlock your Premier Health ID'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) {
    return true;
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
