"use client"

import * as React from "react"
import Link from "next/link"
import { Minus, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { highlight } from "@/lib/highlight"
import { ServiceMorph } from "@/components/services-morph"
import { serviceIcon } from "@/lib/service-icons"


export type ServiceItem = {
  _id: string
  title?: string | null
  slug?: string | null
  summary?: string | null
  icon?: string | null
}

export type ServicesSectionProps = {
  eyebrow?: string | null
  heading?: string | null
  intro?: string | null
  services?: ServiceItem[] | null
}

/**
 * Services list with a heart-monitor panel whose trace morphs into the icon of
 * the service being read. Selection is driven purely by the accordion: opening
 * a service is what changes the monitor. The section scrolls like any other.
 */
export function ServicesSection({ eyebrow, heading, intro, services }: ServicesSectionProps) {
  const items = services ?? []
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [isOpen, setIsOpen] = React.useState(true)

  if (items.length === 0) return null

  const activeService = items[activeIndex] ?? items[0]

  const handleSelect = (index: number) => {
    setIsOpen((open) => (index === activeIndex ? !open : true))
    setActiveIndex(index)
  }

  return (
    <section
      id="services"
      className="bg-background py-20 md:py-32"
      style={{ scrollMarginTop: "var(--header-h, 93px)" }}
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Left: heading and the monitor */}
          <div>
            {eyebrow && (
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {eyebrow}
              </span>
            )}
            <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl xl:text-5xl">
              {highlight(heading)}
            </h2>
            {intro && (
              <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
                {intro}
              </p>
            )}

            <ServiceMorph
              className="mt-8 w-full max-w-sm"
              iconKey={activeService?.icon ?? "stethoscope"}
              label={activeService?.title}
              index={activeIndex}
              total={items.length}
            />
          </div>

          {/* Right: the service list */}
          <div className="flex flex-col divide-y divide-border">
            {items.map((service, index) => {
              const Icon = serviceIcon(service.icon)
              const isActive = index === activeIndex
              const rowOpen = isActive && isOpen

              return (
                <div key={service._id} className="py-3">
                  <button
                    className="flex w-full items-center justify-between gap-4 text-left"
                    onClick={() => handleSelect(index)}
                    aria-expanded={rowOpen}
                  >
                    <div className="flex items-center gap-4">
                      <Icon
                        className={cn(
                          "h-5 w-5 transition-colors",
                          isActive ? "text-accent" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "text-base font-medium transition-colors md:text-lg",
                          isActive ? "text-foreground" : "text-foreground/70",
                        )}
                      >
                        {service.title}
                      </span>
                    </div>
                    {rowOpen ? (
                      <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {rowOpen && (
                    <div className="mt-2 pl-9">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {service.summary}
                      </p>
                      {service.slug && (
                        <Link
                          href={`/services/${service.slug}`}
                          className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
                        >
                          Learn more
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
