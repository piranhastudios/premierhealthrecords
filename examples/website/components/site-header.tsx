import { Header } from "@/components/header"
import type { BookingSite } from "@/components/booking/booking-dialog"
import { bookingDisabledReason, getBookingDirectory } from "@/lib/medplum"
import { sanityFetch } from "@/sanity/lib/live"
import { LOCATIONS_QUERY, SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

type LocationRow = {
  _id: string
  name?: string | null
  address?: string | null
  slug?: string | null
  fhirLocationId?: string | null
}

/**
 * Server wrapper that feeds CMS content (the logo, the clinic phone) and the
 * booking directory (sites from Sanity, doctors and services from Medplum) into
 * the client-side Header.
 */
export async function SiteHeader({ variant }: { variant?: "transparent" | "solid" }) {
  const [{ data: settings }, { data: locations }] = await Promise.all([
    sanityFetch({ query: SITE_SETTINGS_QUERY }),
    sanityFetch({ query: LOCATIONS_QUERY }),
  ])

  const disabled = bookingDisabledReason()
  if (disabled) {
    console.log(`[booking] online booking is off: ${disabled}`)
  }
  // Match on the slug so the same CMS document resolves in whichever Medplum
  // project this environment points at; the recorded id is only a fallback.
  const rows = ((locations ?? []) as LocationRow[]).filter((row) => row.slug || row.fhirLocationId)
  const keyOf = (row: LocationRow) => (row.slug ?? row.fhirLocationId) as string
  const directory = await getBookingDirectory(rows.map(keyOf))
  const bookingSites: BookingSite[] = rows.map((row) => ({
    id: row._id,
    name: row.name ?? "Premier Health Centre",
    address: row.address,
    fhirLocationId: directory[keyOf(row)]?.fhirLocationId ?? (row.fhirLocationId as string),
    practitioners: directory[keyOf(row)]?.practitioners ?? [],
    services: directory[keyOf(row)]?.services ?? [],
  }))

  return (
    <Header variant={variant} logo={settings?.logo} bookingSites={bookingSites} phone={settings?.phone} />
  )
}
