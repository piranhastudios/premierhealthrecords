"use client"

import {useEffect} from "react"
import {useRouter} from "next/navigation"
import {useLocale} from "next-intl"

import {persistLocale} from "@/i18n/client"
import {isLocale, LOCALE_STORAGE_KEY} from "@/i18n/config"

/**
 * Makes the browser's stored language win. If localStorage says one thing
 * and the server rendered another (first visit on a new device, cleared
 * cookies), re-sync the cookie and re-render once.
 */
export function LocaleSync() {
  const locale = useLocale()
  const router = useRouter()

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    } catch {
      return
    }
    if (isLocale(stored) && stored !== locale) {
      persistLocale(stored)
      router.refresh()
    }
  }, [locale, router])

  return null
}
