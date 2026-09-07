/**
 * Build a dialable `tel:` URI from a phone number as an editor typed it.
 *
 * The CMS holds numbers formatted for reading ("+(237) 6 97 97 81 70"). Brackets and
 * spaces are not valid in a tel: URI and stop some phones dialling, so keep only the
 * digits, plus a leading + when the number is international.
 */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "")
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`
}
