// Crash + error reporting (Sentry).
//
// Why this wrapper exists rather than importing Sentry directly everywhere:
//   1. Reporting is OPT-IN via a build-time DSN (`SENTRY_DSN` -> app.config.js
//      `extra.sentryDsn`). With no DSN the app must still run perfectly — local
//      dev and anyone building this example without a Sentry account.
//   2. It gives us one place to scrub PHI. This is a patient record app: a
//      stack trace may carry a patient id, a FHIR URL, or a name. Nothing
//      leaves the device unless it has been through `scrub()` below.
//
// Initialised from `index.ts` BEFORE expo-router loads, so a crash during
// module evaluation (the "app closes instantly on launch" class of bug) is
// still captured. Sentry's native layer also catches Java/Kotlin/C++ crashes
// that never reach JS.
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { sentryDsn?: string };
const dsn = extra.sentryDsn?.trim() ?? '';

/** True when a DSN was baked in at build time, so reports actually leave the device. */
export const crashReportingEnabled = dsn.length > 0;

/** FHIR resource ids and the paths that contain them are the main PHI leak risk
 *  in a stack trace or breadcrumb. Replace them with a stable placeholder. */
const RESOURCE_ID = /\b([A-Z][A-Za-z]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/g;

function scrubString(value: string): string {
  return value.replace(RESOURCE_ID, '$1/<id>').replace(BEARER, '$1 <redacted>');
}

/** Recursively scrub a Sentry payload. Depth-capped: event payloads are shallow
 *  but `extra`/`contexts` are caller-supplied and could be cyclic. */
function scrub<T>(value: T, depth = 0): T {
  if (depth > 6) {
    return value;
  }
  if (typeof value === 'string') {
    return scrubString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrub(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Start crash reporting. Safe to call when no DSN is configured (no-op) and
 * safe to call more than once. Never throws — a reporting failure must not be
 * the thing that takes the app down.
 */
export function initCrashReporting(): void {
  if (!crashReportingEnabled) {
    return;
  }
  try {
    Sentry.init({
      dsn,
      // Traces are not useful to us yet and cost quota; crashes are.
      tracesSampleRate: 0,
      // Breadcrumbs make a launch crash readable (which module loaded last).
      maxBreadcrumbs: 50,
      // PHI: never attach request bodies, cookies or user ip.
      sendDefaultPii: false,
      beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
      beforeSend: (event) => scrub(event),
    });
  } catch {
    // Reporting is best-effort by definition.
  }
}

/** Report a handled error (one we caught and recovered from) with optional context. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!crashReportingEnabled) {
    if (__DEV__) {
      console.warn('[reportError]', error, context);
    }
    return;
  }
  try {
    Sentry.captureException(error, context ? { extra: scrub(context) } : undefined);
  } catch {
    // best effort
  }
}

/** Note a milestone so a later crash report shows how far launch got. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!crashReportingEnabled) {
    return;
  }
  try {
    Sentry.addBreadcrumb({ message: scrubString(message), data: data ? scrub(data) : undefined });
  } catch {
    // best effort
  }
}
