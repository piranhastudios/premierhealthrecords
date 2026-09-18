"use client"

import { useEffect, useSyncExternalStore } from "react"
import { Inter, Playfair_Display } from "next/font/google"
import posthog from "posthog-js"

import { defaultLocale, isLocale, LOCALE_STORAGE_KEY, type Locale } from "@/i18n/config"
import en from "@/messages/en.json"
import fr from "@/messages/fr.json"
import "./globals.css"

// global-error replaces the root layout entirely, so it inherits nothing from
// app/layout.tsx: it has to bring its own <html>, stylesheet and fonts.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
})

const copy: Record<Locale, typeof en.error> = { en: en.error, fr: fr.error }

function subscribe(): () => void {
  // The language cannot change while the site is showing a crash screen.
  return () => {}
}

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : defaultLocale
  } catch {
    // Storage blocked: the default language is a fine answer.
    return defaultLocale
  }
}

/**
 * The last resort when a render throws above the root layout.
 *
 * next-intl is unavailable here — this is a client component outside
 * NextIntlClientProvider with no request scope — so the language comes from the
 * same localStorage key components/locale-sync.tsx treats as the source of
 * truth, and the copy is picked from the message files directly. Both files are
 * bundled into this chunk, which only loads when the site has already broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Rendered on the server as the default language, then corrected on the
  // client once localStorage is readable, without a hydration mismatch.
  const locale = useSyncExternalStore(subscribe, readStoredLocale, () => defaultLocale)

  useEffect(() => {
    posthog.captureException(error)
  }, [error])

  const t = copy[locale]

  return (
    <html lang={locale} className={`${inter.variable} ${playfair.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <h1 className="font-serif text-3xl">{t.title}</h1>
          <p className="max-w-md text-muted-foreground">{t.body}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-full bg-accent px-6 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
            >
              {t.retry}
            </button>
            {/* Deliberately a plain link: a full page load is the point here, where a
                client-side transition would re-mount the tree that just crashed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="rounded-full border border-border px-6 py-2 text-sm font-medium transition-colors hover:bg-muted">
              {t.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
