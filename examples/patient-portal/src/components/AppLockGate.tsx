import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { authenticateForUnlock, isAppLockEnabled } from '../lib/appLock';
import { heroGradient } from '../theme/tokens';

/**
 * Coming back within this window does not re-prompt. It exists to absorb the
 * OS briefly backgrounding us — a notification shade pull, a permission dialog,
 * switching out to copy a code from an SMS — not to weaken the lock. Anything
 * longer than a glance re-locks.
 */
const GRACE_MS = 15_000;

/**
 * Requires a biometric (or the device passcode) before the signed-in app is
 * usable, on cold start AND when returning from the background.
 *
 * Sits above the router in `app/_layout.tsx` rather than inside a screen, so
 * there is no moment where a real screen is mounted and readable behind the
 * prompt, and so it applies no matter which route the app was last on.
 */
export function AppLockGate({ children }: { children: ReactNode }): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const router = useRouter();

  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  /** Unlocked for THIS foreground session; reset whenever we re-lock. */
  const [unlocked, setUnlocked] = useState(false);
  const [prompting, setPrompting] = useState(false);

  // The system auth prompt itself sends the app to 'inactive'/'background' on
  // both platforms. Without this guard, showing the prompt re-triggers the lock
  // that showed it — an unbreakable loop.
  const authenticating = useRef(false);
  const backgroundedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => setEnabled(await isAppLockEnabled()))();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (authenticating.current) {
        return;
      }
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (next === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = undefined;
        if (since !== undefined && Date.now() - since > GRACE_MS) {
          setUnlocked(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    authenticating.current = true;
    setPrompting(true);
    try {
      if (await authenticateForUnlock()) {
        setUnlocked(true);
      }
    } finally {
      authenticating.current = false;
      backgroundedAt.current = undefined;
      setPrompting(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    // The way out for anyone whose biometrics have stopped working. Without it
    // a failed prompt is a dead end on a screen holding someone's records.
    await medplum.signOut().catch(() => undefined);
    setUnlocked(true);
    router.replace('/(auth)/sign-in');
  }, [medplum, router]);

  // Only gate a signed-in app: there is nothing to protect on the sign-in
  // screen, and locking it would be a trap. `enabled === undefined` means the
  // preference is still loading — don't flash the UI before we know.
  const locked = Boolean(profile) && enabled === true && !unlocked;

  // Auto-prompt ONCE per lock, so the common path is a single glance at the
  // sensor with no extra tap. Retries are driven by the Unlock button: without
  // the ref, cancelling the prompt would clear `prompting`, re-satisfy this
  // effect and re-open it immediately — a prompt the user cannot escape.
  const autoPrompted = useRef(false);
  useEffect(() => {
    if (!locked) {
      autoPrompted.current = false;
      return;
    }
    if (autoPrompted.current) {
      return;
    }
    autoPrompted.current = true;
    void unlock();
  }, [locked, unlock]);

  if (!locked) {
    return <>{children}</>;
  }

  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      className="flex-1 items-center justify-center px-8"
    >
      <Text className="text-white text-3xl font-extrabold mb-3">Premier Health</Text>
      <Text className="text-white/90 text-base text-center mb-8">Unlock to view your records.</Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => void unlock()}
        disabled={prompting}
        className={`bg-white rounded-full px-8 py-4 ${prompting ? 'opacity-60' : 'active:opacity-80'}`}
      >
        <Text className="text-ink text-base font-bold">{prompting ? 'Waiting…' : 'Unlock'}</Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => void signOut()} className="mt-6 active:opacity-70">
        <Text className="text-white/80 text-sm underline">Sign in with a different account</Text>
      </Pressable>
      <View className="h-8" />
    </LinearGradient>
  );
}
