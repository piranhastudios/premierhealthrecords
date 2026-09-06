import type { Metadata } from "next"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"

import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"
import { SanityImage } from "@/components/sanity-image"
import { sanityFetch } from "@/sanity/lib/live"
import { POSTS_QUERY } from "@/sanity/lib/queries"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("blog")
  return { title: t("metaTitle"), description: t("metaDescription") }
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return null
  return new Date(value).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export default async function BlogPage() {
  const [{ data: posts }, t, locale] = await Promise.all([
    sanityFetch({ query: POSTS_QUERY }),
    getTranslations("blog"),
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

          {posts.length === 0 ? (
            <p className="mt-10 text-base text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article key={post._id} className="flex flex-col">
                  <Link href={`/blog/${post.slug}`} className="group flex flex-col">
                    {post.mainImage?.asset ? (
                      <div className="relative aspect-[3/2] overflow-hidden rounded-2xl">
                        <SanityImage
                          image={post.mainImage}
                          imageWidth={800}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          sizes="(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw"
                        />
                      </div>
                    ) : null}
                    <div className="mt-5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {formatDate(post.publishedAt, locale) && <span>{formatDate(post.publishedAt, locale)}</span>}
                        {post.categories?.map((category) => (
                          <span
                            key={category._id}
                            className="rounded-full bg-accent/10 px-2 py-0.5 text-accent"
                          >
                            {category.title}
                          </span>
                        ))}
                      </div>
                      <h2 className="mt-3 font-serif text-xl leading-snug tracking-tight text-foreground transition-colors group-hover:text-accent md:text-2xl">
                        {post.title}
                      </h2>
                      {post.excerpt && (
                        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                          {post.excerpt}
                        </p>
                      )}
                      {post.author?.name && (
                        <p className="mt-4 text-xs text-muted-foreground">{t("by", { name: post.author.name })}</p>
                      )}
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  )
}
