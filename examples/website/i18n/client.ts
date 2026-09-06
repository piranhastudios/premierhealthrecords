import {LOCALE_COOKIE, LOCALE_STORAGE_KEY, type Locale} from "./config"

/** Remember the visitor's language in the browser and tell the server about it. */
export function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage can be unavailable (private mode, blocked); the cookie still works.
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
}
