import type { Metadata } from "next"

import { Footer } from "@/components/footer"
import { ServicesPageContent } from "@/components/services-page-content"
import { SiteHeader } from "@/components/site-header"
import { sanityFetch } from "@/sanity/lib/live"
import { SERVICES_PAGE_QUERY } from "@/sanity/lib/queries"

export const metadata: Metadata = {
  title: "Services | Premier Health Centres",
  description:
    "The medical services offered at Premier Health Centres, from general practice to specialist care.",
}

export default async function ServicesPage() {
  const { data: services } = await sanityFetch({ query: SERVICES_PAGE_QUERY })

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <ServicesPageContent services={services} />
      <Footer />
    </div>
  )
}
