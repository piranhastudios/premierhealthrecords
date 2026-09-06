import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ExternalLink, FileText } from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"
import { RichText } from "@/components/portable-text"
import { sanityFetch } from "@/sanity/lib/live"
import { PUBLICATION_QUERY, PUBLICATION_SLUGS_QUERY } from "@/sanity/lib/queries"

type Props = { params: Promise<{ slug: string }> }

const typeLabels: Record<string, string> = {
  research: "Research paper",
  report: "Clinical report",
  guideline: "Health guideline",
  resource: "Patient resource",
  newsletter: "Newsletter",
}

export async function generateStaticParams() {
  const { data } = await sanityFetch({
    query: PUBLICATION_SLUGS_QUERY,
    perspective: "published",
    stega: false,
  })

  return data.filter((item) => item.slug).map((item) => ({ slug: item.slug as string }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data: publication } = await sanityFetch({
    query: PUBLICATION_QUERY,
    params: await params,
    stega: false,
  })

  if (!publication) return {}

  return {
    title: publication.seo?.title ?? `${publication.title} | Premier Health Centres`,
    description: publication.seo?.description ?? publication.abstract ?? undefined,
  }
}

function formatDate(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export default async function PublicationPage({ params }: Props) {
  const { data: publication } = await sanityFetch({
    query: PUBLICATION_QUERY,
    params: await params,
  })

  if (!publication) notFound()

  const contributors = [
    ...(publication.authors?.map((author) => author.name) ?? []),
    ...(publication.externalAuthors ?? []),
  ].filter(Boolean)

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <article className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 md:px-8">
          <Link href="/publications" className="text-sm text-accent hover:underline">
            ← Back to publications
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {publication.publicationType && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                {typeLabels[publication.publicationType] ?? publication.publicationType}
              </span>
            )}
            {formatDate(publication.publishedAt) && (
              <span>{formatDate(publication.publishedAt)}</span>
            )}
            {publication.journal && <span>{publication.journal}</span>}
          </div>

          <h1 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl">
            {publication.title}
          </h1>

          {contributors.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">{contributors.join(", ")}</p>
          )}

          {publication.abstract && (
            <div className="mt-8 rounded-2xl bg-muted p-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Abstract
              </h2>
              <p className="mt-3 text-base leading-relaxed text-foreground">
                {publication.abstract}
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            {publication.fileUrl && (
              <a
                href={publication.fileUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
              >
                <FileText className="h-4 w-4" />
                Download PDF
              </a>
            )}
            {publication.externalUrl && (
              <a
                href={publication.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                View original
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

          <div className="mt-10">
            <RichText value={publication.body} />
          </div>
        </div>
      </article>

      <Footer />
    </main>
  )
}
