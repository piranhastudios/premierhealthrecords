import type { Metadata } from "next"
import Link from "next/link"
import { FileText } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"
import { stegaClean } from "next-sanity"

import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"
import { sanityFetch } from "@/sanity/lib/live"
import { PUBLICATIONS_QUERY } from "@/sanity/lib/queries"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publications")
  return { title: t("metaTitle"), description: t("metaDescription") }
}

// Translation key for each publication type. Values from Sanity carry stega
// metadata, so they are cleaned before being used as a lookup key.
const TYPE_KEYS = {
  research: "types.research",
  report: "types.report",
  guideline: "types.guideline",
  resource: "types.resource",
  newsletter: "types.newsletter",
} as const
type PublicationType = keyof typeof TYPE_KEYS
const isPublicationType = (value: string): value is PublicationType => value in TYPE_KEYS

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return null
  return new Date(value).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric" })
}

export default async function PublicationsPage() {
  const [{ data: publications }, t, locale] = await Promise.all([
    sanityFetch({ query: PUBLICATIONS_QUERY }),
    getTranslations("publications"),
    getLocale(),
  ])

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("eyebrow")}
          </span>
          <h1 className="mt-4 max-w-2xl font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
            {t("title")}
          </h1>

          {publications.length === 0 ? (
            <p className="mt-10 text-base text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="mt-12 flex flex-col divide-y divide-border border-t border-border">
              {publications.map((publication) => {
                const contributors = [
                  ...(publication.authors?.map((author) => author.name) ?? []),
                  ...(publication.externalAuthors ?? []),
                ].filter(Boolean)

                return (
                  <article key={publication._id} className="py-8">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {publication.publicationType && (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                          {isPublicationType(publication.publicationType) ? t(TYPE_KEYS[stegaClean(publication.publicationType)]) : publication.publicationType}
                        </span>
                      )}
                      {formatDate(publication.publishedAt, locale) && (
                        <span>{formatDate(publication.publishedAt, locale)}</span>
                      )}
                      {publication.journal && <span>{publication.journal}</span>}
                    </div>

                    <h2 className="mt-3 font-serif text-xl leading-snug tracking-tight text-foreground md:text-2xl">
                      <Link
                        href={`/publications/${publication.slug}`}
                        className="transition-colors hover:text-accent"
                      >
                        {publication.title}
                      </Link>
                    </h2>

                    {contributors.length > 0 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {contributors.join(", ")}
                      </p>
                    )}

                    {publication.abstract && (
                      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                        {publication.abstract}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                      <Link
                        href={`/publications/${publication.slug}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {t("readMore")}
                      </Link>
                      {publication.fileUrl && (
                        <a
                          href={publication.fileUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <FileText className="h-4 w-4" />
                          {t("pdf")}
                        </a>
                      )}
                      {publication.doi && (
                        <a
                          href={`https://doi.org/${publication.doi}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          DOI: {publication.doi}
                        </a>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  )
}
