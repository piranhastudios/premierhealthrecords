import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Footer } from "@/components/footer"
import { SanityImage } from "@/components/sanity-image"
import { SiteHeader } from "@/components/site-header"
import { highlight } from "@/lib/highlight"
import { sanityFetch } from "@/sanity/lib/live"
import { TEAM_QUERY } from "@/sanity/lib/queries"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("aboutPage")
  return { title: t("metaTitle"), description: t("metaDescription") }
}

// Artwork mirrors the original premierhealthcentrescameroon.com About page;
// the copy lives in messages/*.json so it exists in both languages.
const values = [
  { key: "quality", icon: "/images/about/icons/quality-healthcare.svg" },
  { key: "time", icon: "/images/about/icons/time_effectiveness.svg" },
  { key: "humanized", icon: "/images/about/icons/humanised_care.svg" },
  { key: "international", icon: "/images/about/icons/international_standards.svg" },
] as const

/** Two-letter monogram for team members who have no portrait yet. */
function initials(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/^(Prof(essor)?|Dr|Mme|Ms|Mr|Mrs)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export default async function AboutPage() {
  const [{ data: team }, t, common] = await Promise.all([
    sanityFetch({ query: TEAM_QUERY }),
    getTranslations("aboutPage"),
    getTranslations("common"),
  ])

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

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
                {t("p1")}
              </p>

              <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">{t("p2")}</p>

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

            {/* The centre itself */}
            <div className="relative">
              <div className="absolute -top-4 right-1/4 text-xl text-accent/30">+</div>
              <div className="absolute top-1/4 -right-2 text-xl text-accent/30">+</div>
              <div className="absolute bottom-1/4 right-1/3 text-xl text-accent/30">+</div>

              <div className="relative h-80 md:h-96 lg:h-[450px]">
                <div className="absolute right-0 top-0 h-48 w-40 overflow-hidden rounded-2xl border border-border shadow-lg md:h-56 md:w-48 lg:h-64 lg:w-56">
                  <Image
                    src="/images/about/phc-front-desk.png"
                    alt={t("frontDeskAlt")}
                    fill
                    sizes="224px"
                    className="object-cover"
                  />
                </div>
                <div className="absolute bottom-0 left-0 h-48 w-52 overflow-hidden rounded-2xl border border-border shadow-lg md:h-56 md:w-60 lg:left-12 lg:h-64 lg:w-72">
                  <Image
                    src="/images/about/front-of-house.png"
                    alt={t("frontOfHouseAlt")}
                    fill
                    sizes="288px"
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core values */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t("valuesEyebrow")}
              </span>
              <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
                {highlight(t("valuesTitle"))}
              </h2>
              <div className="mt-10 space-y-8">
                {values.map((value) => (
                  <div key={value.key} className="flex gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-card p-3">
                      <Image src={value.icon} alt="" width={44} height={41} className="h-auto w-full" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold uppercase tracking-wide text-foreground">
                        {t(`values.${value.key}.title`)}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {t(`values.${value.key}.description`)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="sticky top-32">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-border shadow-lg">
                  <Image
                    src="/images/about/core-values-hero.png"
                    alt={t("valuesImageAlt")}
                    fill
                    sizes="(min-width: 1024px) 40vw, 100vw"
                    className="object-cover"
                  />
                </div>
                <div className="absolute -bottom-4 -left-4 text-2xl text-accent/30">+</div>
                <div className="absolute -top-4 -right-4 text-2xl text-accent/30">+</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Team, managed in Sanity: authors marked as current team members */}
      {team.length > 0 && (
        <section className="bg-card py-20 md:py-32">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="text-center">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {t("teamEyebrow")}
              </span>
              <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
                {highlight(t("teamTitle"))}
              </h2>
            </div>

            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {team.map((member) => (
                <div
                  key={member._id}
                  className="rounded-2xl border border-border bg-background p-6 text-center transition-shadow hover:shadow-lg"
                >
                  <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-full border-2 border-accent/20 bg-muted">
                    {member.image?.asset ? (
                      <SanityImage
                        image={member.image}
                        imageWidth={400}
                        alt={member.image.alt || member.name || ""}
                        fill
                        sizes="112px"
                        className="object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-full w-full items-center justify-center font-serif text-2xl text-accent"
                      >
                        {initials(member.name)}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-5 font-serif text-lg font-medium text-foreground">{member.name}</h3>
                  {member.role && (
                    <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-accent">
                      {member.role}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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
              {common("bookAppointment")}
            </Link>
            <Link
              href="/services"
              className="inline-flex items-center justify-center rounded-full border border-card/30 px-8 py-3 text-sm font-semibold text-card transition-colors hover:bg-card/10"
            >
              {common("viewServices")}
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
