import { SanityImage, type SanityImageValue } from "@/components/sanity-image"

export type PartnerItem = {
  _id: string
  name?: string | null
  website?: string | null
  logo?: SanityImageValue
}

export type PartnersSectionProps = {
  heading?: string | null
  intro?: string | null
  partners?: PartnerItem[] | null
}

/**
 * Logo sizing is done with inline styles rather than utility classes on
 * purpose. The artwork is far wider than its slot, so if the classes are ever
 * missing (a stale stylesheet in dev is enough) the images fall back to their
 * intrinsic width, spill out of the row and pile up on top of each other.
 * Inline styles cannot go missing, and the overflow clip on the slot is a
 * second line of defence.
 */
const LOGO_STYLE: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  width: "auto",
  height: "auto",
  objectFit: "contain",
}

export function PartnersSection({ heading, intro, partners }: PartnersSectionProps) {
  const items = partners ?? []

  if (items.length === 0) return null

  return (
    <section id="partners" className="bg-foreground py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:gap-14">
          {/* Minor column: wide enough for the sentence to read, so the logos
              still get the lion's share of the row. */}
          <div className="md:w-1/5 md:min-w-52 md:shrink-0">
            <h2 className="font-serif text-2xl leading-tight tracking-tight text-background md:text-3xl">
              {heading}
            </h2>
            {intro && (
              <p className="mt-3 text-sm leading-relaxed text-background/70">{intro}</p>
            )}
          </div>

          {/* One strictly horizontal row. The slots share the space evenly and
              never wrap; on a narrow screen the row scrolls instead. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex flex-nowrap items-center gap-3 md:gap-8">
              {items.map((partner) => {
                const content = partner.logo?.asset ? (
                  <SanityImage
                    image={partner.logo}
                    imageWidth={400}
                    alt={partner.logo.alt || partner.name || ""}
                    width={200}
                    height={100}
                    style={LOGO_STYLE}
                  />
                ) : (
                  <span className="truncate text-sm font-semibold text-background">
                    {partner.name}
                  </span>
                )

                const className =
                  "flex h-11 min-w-12 flex-1 items-center justify-center overflow-hidden transition-opacity hover:opacity-75 md:h-16 md:min-w-22"

                return partner.website ? (
                  <a
                    key={partner._id}
                    href={partner.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={className}
                    title={partner.name ?? undefined}
                  >
                    {content}
                  </a>
                ) : (
                  <div key={partner._id} className={className} title={partner.name ?? undefined}>
                    {content}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
