export const locales = ["en", "fr"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "en"

/**
 * The language choice lives in the browser (localStorage) as the source of
 * truth, and is mirrored into this cookie so the server can render pages in
 * the chosen language on the first byte instead of flashing English first.
 */
export const LOCALE_COOKIE = "locale"
export const LOCALE_STORAGE_KEY = "locale"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value)
}
