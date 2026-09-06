import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { SanityImage } from "@/components/sanity-image"
import { sanityFetch } from "@/sanity/lib/live"
import { SERVICES_QUERY, SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

const navigation = [
  { key: "home", href: "/" },
  { key: "about", href: "/about" },
  { key: "services", href: "/services" },
  { key: "blog", href: "/blog" },
  { key: "publications", href: "/publications" },
  { key: "contact", href: "/#contact" },
] as const

const social = [
  { name: "Facebook", href: "#" },
  { name: "Instagram", href: "#" },
  { name: "Twitter", href: "#" },
  { name: "LinkedIn", href: "#" },
]

/** How many services the footer lists before pointing at the full page. */
const FOOTER_SERVICES = 4

export async function Footer() {
  const [{ data: settings }, { data: services }, t, nav] = await Promise.all([
    sanityFetch({ query: SITE_SETTINGS_QUERY }),
    sanityFetch({ query: SERVICES_QUERY }),
    getTranslations("footer"),
    getTranslations("nav"),
  ])

  return (
    <footer className="bg-muted py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              {settings?.logo?.asset ? (
                <SanityImage
                  image={settings.logo}
                  imageWidth={702}
                  alt={settings.title ?? "Premier Health Centres"}
                  width={234}
                  height={69}
                  className="h-11 w-auto"
                />
              ) : (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                    <span className="text-xl font-bold text-background">P</span>
                  </div>
                  <div>
                    <span className="text-lg font-semibold tracking-tight text-foreground">Premier</span>
                    <span className="block text-xs text-muted-foreground">Health Centres</span>
                  </div>
                </>
              )}
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {settings?.description || t("tagline")}
            </p>
          </div>

          {/* Navigation */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("navigation")}
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {navigation.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {nav(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services, from the CMS so names follow the language and the catalogue */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("services")}
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {services.slice(0, FOOTER_SERVICES).map((service) => (
                <li key={service._id}>
                  <Link
                    href={service.slug ? `/services/${service.slug}` : "/services"}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {service.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("connect")}
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {social.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-16 border-t border-border pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-xs text-muted-foreground">{t("rights", { year: new Date().getFullYear() })}</p>
            <div className="flex gap-6">
              <Link href="#" className="text-xs text-muted-foreground hover:text-foreground">
                {t("privacy")}
              </Link>
              <Link href="#" className="text-xs text-muted-foreground hover:text-foreground">
                {t("terms")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
