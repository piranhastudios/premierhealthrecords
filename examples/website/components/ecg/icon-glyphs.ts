/**
 * Icon geometry for the services heart-monitor, generated from the Lucide
 * icon set (lucide-react 0.564.0, ISC licensed) so the morph targets match the
 * icons shown beside each service in the accordion.
 *
 * Every entry lists the icon's sub-paths in Lucide's own 24x24 coordinate
 * space. The monitor renders one line per sub-path and uses the same 24x24
 * viewBox, so no coordinate conversion is needed anywhere: a line can morph
 * straight from the ECG trace into an icon stroke.
 *
 * Regenerate rather than hand-edit if the icon set changes.
 */

/** The resting trace: baseline, P wave, QRS spike, T wave, baseline. */
export const ECG_PATH =
  "M 0 12 H 5.5 Q 6.6 9.9 7.7 12 H 8.9 L 9.7 14.2 L 10.9 3.6 L 12.1 19.4 L 13 12 H 14.2 Q 15.6 9.4 17 12 H 24"

export const ICON_GLYPHS: Record<string, string[]> = {
  stethoscope: [
    "M11 2v2",
    "M5 2v2",
    "M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1",
    "M8 15a6 6 0 0 0 12 0v-3",
    "M 18 10 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0",
  ],
  heart: [
    "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
  ],
  heartPulse: [
    "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
    "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
  ],
  baby: [
    "M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5",
    "M15 12h.01",
    "M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1",
    "M9 12h.01",
  ],
  bone: [
    "M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z",
  ],
  brain: [
    "M12 18V5",
    "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
    "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5",
    "M17.997 5.125a4 4 0 0 1 2.526 5.77",
    "M18 18a4 4 0 0 0 2-7.464",
    "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
    "M6 18a4 4 0 0 1-2-7.464",
    "M6.003 5.125a4 4 0 0 0-2.526 5.77",
  ],
  eye: [
    "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
    "M 9 12 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0",
  ],
  sparkles: [
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
    "M20 2v4",
    "M22 4h-4",
    "M 2 20 a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0",
  ],
  droplet: [
    "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  ],
  activity: [
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  ],
  clipboardList: [
    "M 9 2 H 15 A 1 1 0 0 1 16 3 V 5 A 1 1 0 0 1 15 6 H 9 A 1 1 0 0 1 8 5 V 3 A 1 1 0 0 1 9 2 Z",
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    "M12 11h4",
    "M12 16h4",
    "M8 11h.01",
    "M8 16h.01",
  ],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M16 3.128a4 4 0 0 1 0 7.744",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M 5 7 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0",
  ],
  pill: [
    "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z",
    "m8.5 8.5 7 7",
  ],
  scan: [
    "M3 7V5a2 2 0 0 1 2-2h2",
    "M17 3h2a2 2 0 0 1 2 2v2",
    "M21 17v2a2 2 0 0 1-2 2h-2",
    "M7 21H5a2 2 0 0 1-2-2v-2",
  ],
  microscope: [
    "M6 18h8",
    "M3 22h18",
    "M14 22a7 7 0 1 0 0-14h-1",
    "M9 14h2",
    "M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z",
    "M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3",
  ],
}

/** Widest icon in the set; the monitor always renders this many lines. */
export const MAX_GLYPH_PARTS = 8
