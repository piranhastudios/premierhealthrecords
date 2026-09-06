import type { Metadata } from "next"

import { SiteHeader } from "@/components/site-header"
import { HeroSection } from "@/components/hero-section"
import { ServicesSection } from "@/components/services-section"
import { AboutSection } from "@/components/about-section"
import { PartnersSection } from "@/components/partners-section"
import { ContactSection } from "@/components/contact-section"
import { Footer } from "@/components/footer"
import { sanityFetch } from "@/sanity/lib/live"
import {
  HOME_PAGE_QUERY,
  PARTNERS_QUERY,
  SERVICES_QUERY,
  SITE_SETTINGS_QUERY,
} from "@/sanity/lib/queries"

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await sanityFetch({ query: HOME_PAGE_QUERY, stega: false })

  if (!data?.seo?.title && !data?.seo?.description) return {}

  return {
    title: data.seo?.title ?? undefined,
    description: data.seo?.description ?? undefined,
  }
}

export default async function Home() {
  const [{ data: home }, { data: services }, { data: partners }, { data: settings }] =
    await Promise.all([
      sanityFetch({ query: HOME_PAGE_QUERY }),
      sanityFetch({ query: SERVICES_QUERY }),
      sanityFetch({ query: PARTNERS_QUERY }),
      sanityFetch({ query: SITE_SETTINGS_QUERY }),
    ])

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <HeroSection {...(home?.hero ?? {})} />
      <ServicesSection {...(home?.servicesSection ?? {})} services={services} />
      <AboutSection {...(home?.aboutSection ?? {})} />
      <PartnersSection {...(home?.partnersSection ?? {})} partners={partners} />
      <ContactSection
        {...(home?.contactSection ?? {})}
        phone={settings?.phone}
        email={settings?.email}
        address={settings?.address}
        openingHours={settings?.openingHours}
      />
      <Footer />
    </main>
  )
}
