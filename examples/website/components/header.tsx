"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { Menu, X, User, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { SanityImage, type SanityImageValue } from "@/components/sanity-image"
import { AppointmentForm, type AppointmentServiceOption } from "@/components/appointment-form"
import type { OpeningHoursEntry } from "@/lib/opening-hours"

/**
 * The patient portal is not live yet, so its entry points stay hidden.
 * Set NEXT_PUBLIC_SHOW_PATIENT_PORTAL=true to reveal them.
 */
const SHOW_PATIENT_PORTAL = process.env.NEXT_PUBLIC_SHOW_PATIENT_PORTAL === "true"

const navigation = [
  { key: "home", href: "/" },
  { key: "about", href: "/about" },
  { key: "services", href: "/services" },
  { key: "blog", href: "/blog" },
  { key: "publications", href: "/publications" },
  { key: "contact", href: "/#contact" },
] as const

interface HeaderProps {
  variant?: "transparent" | "solid"
  logo?: SanityImageValue
  openingHours?: (OpeningHoursEntry | null)[] | null
  services?: AppointmentServiceOption[] | null
}

export function Header({ variant = "transparent", logo, openingHours, services }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [appointmentOpen, setAppointmentOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const pathname = usePathname()
  const t = useTranslations("header")
  const nav = useTranslations("nav")

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 8)
    }

    handleScroll()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const showBackground = isScrolled

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href))

  return (
    <header
      className={`sticky top-0 z-50 px-4 py-4 transition-colors duration-300 md:px-8 md:py-6 ${
        showBackground
          ? "border-b border-border/50 bg-card/95 backdrop-blur-sm"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          {logo?.asset ? (
            <SanityImage
              image={logo}
              imageWidth={702}
              alt="Premier Health Centres"
              width={234}
              height={69}
              priority
              className="h-10 w-auto md:h-11"
            />
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                <span className="text-xl font-bold text-accent-foreground">P</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-lg font-semibold tracking-tight text-foreground">Premier</span>
                <span className="block text-xs text-muted-foreground">Health Centres</span>
              </div>
            </>
          )}
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex lg:items-center lg:gap-8">
          {navigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`text-sm font-medium transition-colors hover:text-foreground ${
                isActive(item.href) ? "text-accent" : "text-foreground/80"
              }`}
            >
              {nav(item.key)}
            </Link>
          ))}
        </div>

        {/* Right Side Actions */}
        <div className="hidden lg:flex lg:items-center lg:gap-3">
          {/* Patient Portal Login */}
          {SHOW_PATIENT_PORTAL && (
          <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-full border-border">
                <User className="h-4 w-4" />
                {t("patientPortal")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">{t("login.title")}</DialogTitle>
                <DialogDescription>{t("login.description")}</DialogDescription>
              </DialogHeader>
              <form className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t("login.email")}</Label>
                  <Input id="email" type="email" placeholder={t("login.emailPlaceholder")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <Input id="password" type="password" placeholder={t("login.passwordPlaceholder")} />
                </div>
                <div className="flex items-center justify-between">
                  <Link href="#" className="text-sm text-accent hover:underline">
                    {t("login.forgot")}
                  </Link>
                </div>
                <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                  {t("login.signIn")}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {t("login.noAccount")}{" "}
                  <Link href="#" className="text-accent hover:underline">
                    {t("login.register")}
                  </Link>
                </p>
              </form>
            </DialogContent>
          </Dialog>
          )}

          {/* Book Appointment */}
          <Dialog open={appointmentOpen} onOpenChange={setAppointmentOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
                <Calendar className="h-4 w-4" />
                {t("bookAppointment")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">{t("booking.title")}</DialogTitle>
                <DialogDescription>{t("booking.description")}</DialogDescription>
              </DialogHeader>
              <AppointmentForm openingHours={openingHours} services={services} />
            </DialogContent>
          </Dialog>

          <LocaleSwitcher />
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-2 lg:hidden">
          <LocaleSwitcher />
          <button
            type="button"
            className="p-1"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6 text-foreground" />
            ) : (
              <Menu className="h-6 w-6 text-foreground" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden">
          <div className="mt-4 rounded-2xl bg-card p-6 shadow-lg">
            <div className="flex flex-col gap-4">
              {navigation.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`text-base font-medium transition-colors hover:text-foreground ${
                    isActive(item.href) ? "text-accent" : "text-foreground/80"
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {nav(item.key)}
                </Link>
              ))}
              <hr className="border-border" />
              {SHOW_PATIENT_PORTAL && (
                <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full gap-2 rounded-full">
                      <User className="h-4 w-4" />
                      {t("patientPortal")}
                    </Button>
                  </DialogTrigger>
                </Dialog>
              )}
              <Dialog open={appointmentOpen} onOpenChange={setAppointmentOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full gap-2 rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
                    <Calendar className="h-4 w-4" />
                    {t("bookAppointment")}
                  </Button>
                </DialogTrigger>
              </Dialog>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
