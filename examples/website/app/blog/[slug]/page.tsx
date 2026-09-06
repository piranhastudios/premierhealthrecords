import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"
import { RichText } from "@/components/portable-text"
import { SanityImage } from "@/components/sanity-image"
import { sanityFetch } from "@/sanity/lib/live"
import { POST_QUERY, POST_SLUGS_QUERY } from "@/sanity/lib/queries"

type Props = { params: Promise<{ slug: string }> }

export async function generateStaticParams() {
  const { data } = await sanityFetch({
    query: POST_SLUGS_QUERY,
    perspective: "published",
    stega: false,
  })

  return data.filter((item) => item.slug).map((item) => ({ slug: item.slug as string }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data: post } = await sanityFetch({
    query: POST_QUERY,
    params: await params,
    stega: false,
  })

  if (!post) return {}

  return {
    title: post.seo?.title ?? `${post.title} | Premier Health Centres`,
    description: post.seo?.description ?? post.excerpt ?? undefined,
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

export default async function PostPage({ params }: Props) {
  const { data: post } = await sanityFetch({ query: POST_QUERY, params: await params })

  if (!post) notFound()

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <article className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 md:px-8">
          <Link href="/blog" className="text-sm text-accent hover:underline">
            ← Back to blog
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {formatDate(post.publishedAt) && <span>{formatDate(post.publishedAt)}</span>}
            {post.categories?.map((category) => (
              <span key={category._id} className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">
                {category.title}
              </span>
            ))}
          </div>

          <h1 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
            {post.title}
          </h1>

          {post.author?.name && (
            <p className="mt-4 text-sm text-muted-foreground">
              By {post.author.name}
              {post.author.role ? `, ${post.author.role}` : ""}
            </p>
          )}

          {post.mainImage?.asset ? (
            <div className="relative mt-10 aspect-[16/9] overflow-hidden rounded-2xl">
              <SanityImage
                image={post.mainImage}
                imageWidth={1600}
                fill
                priority
                className="object-cover"
                sizes="(min-width: 1024px) 768px, 100vw"
              />
            </div>
          ) : null}

          <div className="mt-10">
            <RichText value={post.body} />
          </div>
        </div>
      </article>

      <Footer />
    </main>
  )
}
