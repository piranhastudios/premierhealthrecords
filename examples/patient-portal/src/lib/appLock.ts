// App lock: require a biometric (or the device passcode) before the signed-in
// session is usable.
//
// This gates access to an ALREADY-STORED session — it is not a second set of
// credentials. Sign-in still happens once with email + password; the lock just
// stops someone who picks up an unlocked phone from reading medical records.
//
// "Biometric, passcode otherwise" is handled by the OS: `authenticateAsync` with
// `disableDeviceFallback: false` shows the device PIN/pattern/password prompt
// when biometrics fail or none are enrolled. We deliberately do NOT invent an
// in-app PIN — that would be a weaker secret we would have to store, expire and
// offer recovery for, when the device already has one the OS manages.
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const LOCK_KEY = 'phc.appLock';

/** What the device can actually challenge the user with. */
export type LockCapability =
  /** Face ID / Touch ID / fingerprint is enrolled (device passcode still backs it up). */
  | 'biometric'
  /** No biometrics, but a PIN / pattern / password is set. */
  | 'passcode'
  /** The device has no lock at all — we cannot gate anything. */
  | 'none';

/**
 * What this device can challenge with right now.
 *
 * Note this is NOT `isEnrolledAsync()`, which only reports biometric enrolment
 * and would report false on a phone secured with a PIN — locking that user out
 * of the feature for no reason.
 * @returns The strongest challenge available.
 */
export async function getLockCapability(): Promise<LockCapability> {
  if (Platform.OS === 'web') {
    return 'none';
  }
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG || level === LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK) {
      return 'biometric';
    }
    if (level === LocalAuthentication.SecurityLevel.SECRET) {
      return 'passcode';
    }
    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * Prompt for a biometric, falling back to the device passcode.
 * @param reason - Shown in the system prompt.
 * @returns True when the user authenticated.
 */
export async function authenticateForUnlock(reason = 'Unlock Premier Health'): Promise<boolean> {
  if ((await getLockCapability()) === 'none') {
    // Nothing to challenge with. Refusing here would strand the user in a lock
    // screen they cannot pass, so treat an unlockable device as unlocked.
    return true;
  }
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      // false = allow the device PIN / pattern / password as a fallback.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Whether the lock is on. Defaults to ON — an unset preference means enabled,
 * so the protection is there from first launch rather than waiting for someone
 * to find a settings screen. "Off" is stored explicitly so the default can
 * never silently re-enable itself after a user has opted out.
 *
 * Defaulting on is only safe because of two things elsewhere in this module:
 * a device with no screen lock at all is treated as unlocked (there would be
 * nothing to challenge with), and the lock screen offers a way out to the
 * sign-in screen. These are medical records people may need urgently; being
 * stuck behind a prompt that cannot be satisfied is not an acceptable failure.
 * @returns True when the app lock is enabled.
 */
export async function isAppLockEnabled(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(LOCK_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    // Storage unreadable: fail OPEN. A locked-out patient is worse than an
    // unlocked one on a device they are already holding.
    return false;
  }
}

/**
 * Turn the lock on or off. Both states are written explicitly — see
 * {@link isAppLockEnabled} for why "off" cannot just be a deleted key.
 * @param enabled - Desired state.
 */
export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCK_KEY, enabled ? '1' : '0');
  } catch {
    // Best effort — the preference is a convenience, not a security boundary.
  }
}
