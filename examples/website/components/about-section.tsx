import { RichText } from "@/components/portable-text"
import { SanityImage, type SanityImageValue } from "@/components/sanity-image"
import { highlight } from "@/lib/highlight"

type Stat = { _key?: string; value?: string | null; label?: string | null }

export type AboutSectionProps = {
  eyebrow?: string | null
  heading?: string | null
  body?: unknown
  image?: SanityImageValue
  featuredStat?: Stat | null
  stats?: (Stat | null)[] | null
}

export function AboutSection({
  eyebrow,
  heading,
  body,
  image,
  featuredStat,
  stats,
}: AboutSectionProps) {
  const items = (stats ?? []).filter(Boolean) as Stat[]

  return (
    <section id="about" className="bg-muted py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Image */}
          <div className="relative">
            {image?.asset ? (
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                <SanityImage
                  image={image}
                  fill
                  className="object-cover"
                  sizes="(min-width: 1024px) 560px, 100vw"
                />
              </div>
            ) : null}
            {/* Floating card with stat */}
            {featuredStat?.value && (
              <div className="absolute -bottom-6 -right-6 rounded-xl bg-card p-6 shadow-lg md:-bottom-8 md:-right-8 md:p-8">
                <div className="text-center">
                  <span className="block font-serif text-3xl font-semibold text-foreground md:text-4xl">
                    {featuredStat.value}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {featuredStat.label}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex flex-col justify-center">
            {eyebrow && (
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {eyebrow}
              </span>
            )}
            <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              {highlight(heading)}
            </h2>

            <RichText value={body} />

            {/* Stats */}
            {items.length > 0 && (
              <div className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
                {items.map((stat, index) => (
                  <div key={stat._key ?? index}>
                    <span className="font-serif text-2xl font-semibold text-foreground md:text-3xl">
                      {stat.value}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
