import Link from "next/link"

import { SanityImage } from "@/components/sanity-image"
import { sanityFetch } from "@/sanity/lib/live"
import { SITE_SETTINGS_QUERY } from "@/sanity/lib/queries"

const footerLinks = {
  navigation: [
    { name: "Home", href: "/" },
    { name: "About", href: "/about" },
    { name: "Services", href: "/services" },
    { name: "Blog", href: "/blog" },
    { name: "Publications", href: "/publications" },
    { name: "Contact", href: "/#contact" },
  ],
  services: [
    { name: "General Practice", href: "/services/general-practice" },
    { name: "Cardiology", href: "/services/cardiology" },
    { name: "Obstetrics & Gynaecology", href: "/services/obstetrics-gynaecology" },
    { name: "Health Check-up Packages", href: "/services/health-check-up-packages" },
  ],
  social: [
    { name: "Facebook", href: "#" },
    { name: "Instagram", href: "#" },
    { name: "Twitter", href: "#" },
    { name: "LinkedIn", href: "#" },
  ],
}

export async function Footer() {
  const { data: settings } = await sanityFetch({ query: SITE_SETTINGS_QUERY })

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
              Affordable quality healthcare for all your medical needs in Cameroon.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Navigation
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.navigation.map((link) => (
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

          {/* Services */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Services
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.services.map((link) => (
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

          {/* Social */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Connect
            </span>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.social.map((link) => (
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
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Premier Health Centres. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link href="#" className="text-xs text-muted-foreground hover:text-foreground">
                Privacy Policy
              </Link>
              <Link href="#" className="text-xs text-muted-foreground hover:text-foreground">
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
