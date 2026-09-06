"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Minus, Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ClientReturnStega } from "next-sanity"

import { RichText } from "@/components/portable-text"
import { highlight } from "@/lib/highlight"
import { SanityImage } from "@/components/sanity-image"
import { serviceIcon } from "@/lib/service-icons"
import type { SERVICES_PAGE_QUERY } from "@/sanity/lib/queries"

/** Rotated through for services that have no image of their own yet. */
const FALLBACK_IMAGES = [
  "/images/clinic-interior.jpg",
  "/images/patient-care.jpg",
  "/images/hero-healthcare.jpg",
]

/** How many services the hero's quick-navigation card lists before "See all". */
const QUICK_NAV_COUNT = 6

type Props = {
  // Live fetches brand every string with stega metadata for Visual Editing;
  // this derives that exact shape from the query, so the prop always matches
  // what app/services/page.tsx hands in.
  services: ClientReturnStega<typeof SERVICES_PAGE_QUERY>
  phone?: string | null
}

export function ServicesPageContent({ services, phone }: Props) {
  const t = useTranslations("servicesPage")
  const common = useTranslations("common")
  const [expandedId, setExpandedId] = useState<string | null>(services[0]?._id ?? null)
  const [openFaq, setOpenFaq] = useState<string | null>(null)

  return (
    <>
      {/* Hero */}
      <section
        className="bg-card py-16 md:py-24"
        style={{
          marginTop: "calc(var(--header-h, 93px) * -1)",
          paddingTop: "calc(4rem + var(--header-h, 93px))",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t("eyebrow")}
              </span>
              <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl text-balance">
                {highlight(t("title"))}
              </h1>

              <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
                {t("intro")}
              </p>

              <div className="mt-8">
                <Link
                  href="/#contact"
                  className="group inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-accent"
                >
                  {common("bookAppointment")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            {/* Quick navigation */}
            <div className="rounded-2xl border border-border bg-background p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t("quickNav")}
              </h3>
              <div className="mt-4 flex flex-col divide-y divide-border">
                {services.slice(0, QUICK_NAV_COUNT).map((service) => {
                  const Icon = serviceIcon(service.icon)
                  const isExpanded = expandedId === service._id
                  return (
                    <div key={service._id} className="py-3">
                      <button
                        className="flex w-full items-center justify-between gap-4 text-left"
                        onClick={() => setExpandedId(isExpanded ? null : service._id)}
                        aria-expanded={isExpanded}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="h-5 w-5 text-accent" />
                          <span className="text-base font-medium text-foreground">
                            {service.title}
                          </span>
                        </div>
                        {isExpanded ? (
                          <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 pl-8">
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {service.summary}
                          </p>
                          {service.slug && (
                            <a
                              href={`#${service.slug}`}
                              className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
                            >
                              {t("readMoreBelow")}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {services.length > QUICK_NAV_COUNT && (
                <a
                  href="#services-list"
                  className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
                >
                  {t("seeAll", { count: services.length })}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Every service in detail */}
      <section id="services-list" className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="text-center">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t("exploreEyebrow")}
            </span>
            <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              {highlight(t("exploreTitle"))}
            </h2>
          </div>

          <div className="mt-16 space-y-24">
            {services.map((service, index) => {
              const Icon = serviceIcon(service.icon)
              const faqs = service.faqs ?? []
              const fallback = FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]

              return (
                <div
                  key={service._id}
                  id={service.slug ?? undefined}
                  className={`flex flex-col gap-10 lg:gap-16 ${index % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse"}`}
                  style={{ scrollMarginTop: "calc(var(--header-h, 93px) + 1.5rem)" }}
                >
                  {/* Image */}
                  <div className="relative lg:w-1/2">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-border shadow-lg">
                      {service.image?.asset ? (
                        <SanityImage
                          image={service.image}
                          imageWidth={1200}
                          alt={service.image.alt || service.title || ""}
                          fill
                          className="object-cover"
                          sizes="(min-width: 1024px) 50vw, 100vw"
                        />
                      ) : (
                        <Image src={fallback} alt="" fill className="object-cover" />
                      )}
                    </div>
                    <div className="absolute -bottom-3 -left-3 text-xl text-accent/30">+</div>
                    <div className="absolute -top-3 -right-3 text-xl text-accent/30">+</div>
                  </div>

                  {/* Content */}
                  <div className="flex flex-col justify-center lg:w-1/2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card">
                        <Icon className="h-5 w-5 text-accent" />
                      </div>
                      <span className="font-mono text-xs tracking-widest text-accent">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="mt-4 font-serif text-2xl font-medium text-foreground md:text-3xl">
                      {service.title}
                    </h3>

                    {service.body ? (
                      <div className="mt-4 text-muted-foreground">
                        <RichText value={service.body} />
                      </div>
                    ) : (
                      service.summary && (
                        <p className="mt-4 leading-relaxed text-muted-foreground">{service.summary}</p>
                      )
                    )}

                    {service.slug && (
                      <Link
                        href={`/services/${service.slug}`}
                        className="group mt-5 inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-accent"
                      >
                        {t("learnMoreAbout", { title: service.title ?? "" })}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </Link>
                    )}

                    {faqs.length > 0 && (
                      <div className="mt-8">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-foreground">
                          {t("faqTitle")}
                        </h4>
                        <div className="mt-4 space-y-2">
                          {faqs.map((faq) => {
                            const faqKey = `${service._id}-${faq._key}`
                            const isOpen = openFaq === faqKey
                            return (
                              <div key={faq._key} className="rounded-lg border border-border bg-card">
                                <button
                                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                                  onClick={() => setOpenFaq(isOpen ? null : faqKey)}
                                  aria-expanded={isOpen}
                                >
                                  <span className="text-sm font-medium text-foreground">
                                    {faq.question}
                                  </span>
                                  {isOpen ? (
                                    <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  )}
                                </button>
                                {isOpen && (
                                  <div className="border-t border-border px-4 py-3">
                                    <p className="text-sm leading-relaxed text-muted-foreground">
                                      {faq.answer}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-foreground py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center md:px-8">
          <h2 className="font-serif text-3xl font-medium text-card md:text-4xl">{t("ctaTitle")}</h2>
          <p className="mt-4 text-card/80">{t("ctaText")}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/#contact"
              className="inline-flex items-center justify-center rounded-full bg-accent px-8 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              {common("contactUs")}
            </Link>
            {phone && (
              <Link
                href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                className="inline-flex items-center justify-center rounded-full border border-card/30 px-8 py-3 text-sm font-semibold text-card transition-colors hover:bg-card/10"
              >
                {t("call", { phone })}
              </Link>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
