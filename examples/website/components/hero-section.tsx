import { ArrowRight } from "lucide-react"

import { SanityImage, type SanityImageValue } from "@/components/sanity-image"
import { highlight } from "@/lib/highlight"

// Fixed positions for decorative crosses to avoid hydration mismatch
const crossPositions = [
  { top: "5%", left: "8%" },
  { top: "15%", left: "25%" },
  { top: "8%", left: "45%" },
  { top: "20%", left: "65%" },
  { top: "12%", left: "85%" },
  { top: "75%", left: "5%" },
  { top: "65%", left: "20%" },
  { top: "80%", left: "40%" },
  { top: "70%", left: "60%" },
  { top: "85%", left: "75%" },
  { top: "90%", left: "92%" },
  { top: "50%", left: "95%" },
]

export type HeroSectionProps = {
  heading?: string | null
  intro?: string | null
  callToAction?: { label?: string | null; href?: string | null } | null
  backgroundImage?: SanityImageValue
  images?: (SanityImageValue & { _key?: string })[] | null
  announcements?: ({ _key: string; text?: string | null; link?: string | null } | null)[] | null
}

export function HeroSection({
  heading,
  intro,
  callToAction,
  backgroundImage,
  images,
  announcements,
}: HeroSectionProps) {
  const heroImages = (images ?? []).filter((image) => image?.asset)
  const [primaryImage, secondaryImage] = heroImages
  const items = (announcements ?? []).filter(Boolean)

  // The negative top margin pulls the hero up behind the sticky header so the
  // nav floats over the image with no background band. The pt-28 further down
  // keeps the hero content clear of the nav. It is an inline style on purpose:
  // a utility class can be missing from a stale dev stylesheet, and then the
  // band comes back.
  return (
    <section
      className="relative flex min-h-screen items-center overflow-hidden"
      style={{ marginTop: "calc(var(--header-h, 93px) * -1)" }}
    >
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <SanityImage
          image={backgroundImage}
          imageWidth={2000}
          alt=""
          fill
          className="object-cover"
          priority
        />
        {/* Decorative crosses */}
        <div className="absolute inset-0">
          {crossPositions.map((pos, i) => (
            <span
              key={i}
              className="absolute text-card/40 text-2xl font-light"
              style={{
                top: pos.top,
                left: pos.left,
              }}
            >
              +
            </span>
          ))}
        </div>
      </div>

      {/* Floating Card */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-28 pb-16 md:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-3xl border border-white/40 bg-gradient-to-br from-card/70 via-card/55 to-card/40 p-6 shadow-2xl shadow-black/10 ring-1 ring-inset ring-white/30 backdrop-blur-2xl backdrop-saturate-150 md:p-10 lg:p-12 dark:border-white/10 dark:ring-white/5">
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
              {/* Left Content */}
              <div className="flex flex-col justify-center">
                <h1 className="font-serif text-4xl leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl">
                  {highlight(heading)}
                </h1>

                {intro && (
                  <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground md:text-lg">
                    {intro}
                  </p>
                )}

                {callToAction?.href && (
                  <div className="mt-8">
                    <a
                      href={callToAction.href}
                      className="group inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-accent"
                    >
                      {callToAction.label}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </a>
                  </div>
                )}
              </div>

              {/* Right - Images */}
              <div className="relative">
                {/* Decorative crosses */}
                <div className="absolute -top-4 right-1/4 text-accent/50">+</div>
                <div className="absolute top-1/4 -right-2 text-accent/50">+</div>
                <div className="absolute bottom-1/4 right-1/3 text-accent/50">+</div>

                {/* Images */}
                <div className="relative h-72 md:h-80 lg:h-[380px]">
                  {primaryImage?.asset ? (
                    <div className="absolute right-0 top-0 h-44 w-40 overflow-hidden rounded-lg shadow-lg md:h-48 md:w-48 lg:h-56 lg:w-60">
                      <SanityImage
                        image={primaryImage}
                        imageWidth={600}
                        fill
                        className="object-cover"
                        sizes="(min-width: 1024px) 240px, 200px"
                      />
                    </div>
                  ) : null}
                  {secondaryImage?.asset ? (
                    <div className="absolute bottom-0 left-0 h-44 w-52 overflow-hidden rounded-lg shadow-lg md:h-48 md:w-64 lg:left-16 lg:h-56 lg:w-80">
                      <SanityImage
                        image={secondaryImage}
                        imageWidth={800}
                        fill
                        className="object-cover"
                        sizes="(min-width: 1024px) 320px, 260px"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Announcements */}
            {items.length > 0 && (
              <div className="mt-6 grid gap-6 border-t border-foreground/10 pt-6 md:grid-cols-3">
                {items.map((item, index) => (
                  <div key={item!._key}>
                    <span className="text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item!.link ? (
                      <a
                        href={item!.link}
                        className="mt-2 block text-sm font-medium text-foreground transition-colors hover:text-accent"
                      >
                        {item!.text}
                      </a>
                    ) : (
                      <p className="mt-2 text-sm font-medium text-foreground">{item!.text}</p>
                    )}
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
