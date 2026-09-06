import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Footer } from "@/components/footer"
import { ServicesPageContent } from "@/components/services-page-content"
import { SiteHeader } from "@/components/site-header"
import { sanityFetch } from "@/sanity/lib/live"
import { SERVICES_PAGE_QUERY, SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("servicesPage")
  return { title: t("metaTitle"), description: t("metaDescription") }
}

export default async function ServicesPage() {
  const [{ data: services }, { data: settings }] = await Promise.all([
    sanityFetch({ query: SERVICES_PAGE_QUERY }),
    sanityFetch({ query: SITE_SETTINGS_QUERY }),
  ])

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <ServicesPageContent services={services} phone={settings?.phone} />
      <Footer />
    </div>
  )
}
