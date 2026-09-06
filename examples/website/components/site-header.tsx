import { Header } from "@/components/header"
import { sanityFetch } from "@/sanity/lib/live"
import { SERVICES_QUERY, SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

/**
 * Server wrapper that feeds CMS content — the logo, opening hours and the
 * service list used by the booking form — into the client-side Header.
 */
export async function SiteHeader({ variant }: { variant?: "transparent" | "solid" }) {
  const [{ data: settings }, { data: services }] = await Promise.all([
    sanityFetch({ query: SITE_SETTINGS_QUERY }),
    sanityFetch({ query: SERVICES_QUERY }),
  ])

  return (
    <Header
      variant={variant}
      logo={settings?.logo}
      openingHours={settings?.openingHours}
      services={services}
    />
  )
}
