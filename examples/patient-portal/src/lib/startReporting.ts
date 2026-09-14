// Side-effect module: starts crash reporting the moment it is imported.
//
// This exists because `import` declarations are hoisted and evaluated before
// any statement in the importing module. A bare `initCrashReporting()` call in
// index.ts would therefore run AFTER `expo-router/entry` had already loaded the
// whole app — too late to catch the module-evaluation crashes we care about.
// Importing this module first makes the ordering real.
import { initCrashReporting } from './reporting';

initCrashReporting();
