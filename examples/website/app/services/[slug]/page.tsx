import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"
import { RichText } from "@/components/portable-text"
import { SanityImage } from "@/components/sanity-image"
import { sanityFetch } from "@/sanity/lib/live"
import { SERVICES_QUERY, SERVICE_QUERY } from "@/sanity/lib/queries"

type Props = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const { data } = await sanityFetch({
    query: SERVICES_QUERY,
    perspective: "published",
    stega: false,
  })

  return data.filter((item) => item.slug).map((item) => ({ slug: item.slug as string }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data: service } = await sanityFetch({
    query: SERVICE_QUERY,
    params: await params,
    stega: false,
  })

  if (!service) return {}

  return {
    title: service.seo?.title ?? `${service.title} | Premier Health Centres`,
    description: service.seo?.description ?? service.summary ?? undefined,
  }
}

export default async function ServicePage({ params }: Props) {
  const { data: service } = await sanityFetch({ query: SERVICE_QUERY, params: await params })

  if (!service) notFound()

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <article className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 md:px-8">
          <Link href="/services" className="text-sm text-accent hover:underline">
            ← All services
          </Link>

          <h1 className="mt-6 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
            {service.title}
          </h1>

          {service.summary && (
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{service.summary}</p>
          )}

          {service.image?.asset ? (
            <div className="relative mt-10 aspect-[16/9] overflow-hidden rounded-2xl">
              <SanityImage
                image={service.image}
                imageWidth={1600}
                fill
                priority
                className="object-cover"
                sizes="(min-width: 1024px) 768px, 100vw"
              />
            </div>
          ) : null}

          <div className="mt-10">
            <RichText value={service.body} />
          </div>

          <div className="mt-12 rounded-2xl bg-muted p-8">
            <h2 className="font-serif text-xl tracking-tight text-foreground">
              Ready to book an appointment?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Get in touch and our team will confirm a time that works for you.
            </p>
            <Link
              href="/#contact"
              className="mt-5 inline-block text-sm font-semibold text-accent hover:underline"
            >
              Contact us
            </Link>
          </div>
        </div>
      </article>

      <Footer />
    </main>
  )
}
