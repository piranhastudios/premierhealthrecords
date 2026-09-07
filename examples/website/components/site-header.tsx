import { Header } from "@/components/header"
import type { BookingSite } from "@/components/booking/booking-dialog"
import { getBookingDirectory } from "@/lib/medplum"
import { sanityFetch } from "@/sanity/lib/live"
import { LOCATIONS_QUERY, SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

type LocationRow = {
  _id: string
  name?: string | null
  address?: string | null
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

  const rows = ((locations ?? []) as LocationRow[]).filter((row) => row.fhirLocationId)
  const directory = await getBookingDirectory(rows.map((row) => row.fhirLocationId as string))
  const bookingSites: BookingSite[] = rows.map((row) => ({
    id: row._id,
    name: row.name ?? "Premier Health Centre",
    address: row.address,
    fhirLocationId: row.fhirLocationId as string,
    practitioners: directory[row.fhirLocationId as string]?.practitioners ?? [],
    services: directory[row.fhirLocationId as string]?.services ?? [],
  }))

  return (
    <Header
      variant={variant}
      logo={settings?.logo}
      bookingSites={bookingSites}
      calOrigin={process.env.NEXT_PUBLIC_CALDIY_URL}
      phone={settings?.phone}
    />
  )
}
