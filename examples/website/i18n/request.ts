import {cookies} from "next/headers"
import {getRequestConfig} from "next-intl/server"

import {defaultLocale, isLocale, LOCALE_COOKIE} from "./config"

export default getRequestConfig(async () => {
  let locale = defaultLocale
  try {
    const value = (await cookies()).get(LOCALE_COOKIE)?.value
    if (isLocale(value)) locale = value
  } catch {
    // No request scope (build-time work such as generateStaticParams): English.
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
