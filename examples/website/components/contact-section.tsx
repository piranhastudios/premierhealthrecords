"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Phone, Clock, MapPin, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"

type OpeningHours = {
  _key?: string
  days?: string | null
  hours?: string | null
  daysLabel?: string | null
  hoursLabel?: string | null
}

export type ContactSectionProps = {
  eyebrow?: string | null
  heading?: string | null
  intro?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  openingHours?: (OpeningHours | null)[] | null
}

export function ContactSection({
  eyebrow,
  heading,
  intro,
  phone,
  email,
  address,
  openingHours,
}: ContactSectionProps) {
  const hours = (openingHours ?? []).filter(Boolean) as OpeningHours[]
  const t = useTranslations("contact")
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    message: "",
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Handle form submission
    console.log(formData)
  }

  return (
    <section id="contact" className="bg-background py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="text-center">
          {eyebrow && (
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </span>
          )}
          <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
            {heading}
          </h2>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Contact Info */}
          <div>
            {intro && (
              <p className="text-base leading-relaxed text-muted-foreground">{intro}</p>
            )}

            <div className="mt-8 flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <Phone className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{t("phone")}</span>
                  <p className="mt-1 text-sm text-muted-foreground">{phone}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <Clock className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{t("hours")}</span>
                  {hours.map((entry, index) => (
                    <p
                      key={entry._key ?? index}
                      className={index === 0 ? "mt-1 text-sm text-muted-foreground" : "text-sm text-muted-foreground"}
                    >
                      {entry.daysLabel ?? entry.days}: {entry.hoursLabel ?? entry.hours}
                    </p>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <MapPin className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{t("location")}</span>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{address}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                  <Mail className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{t("email")}</span>
                  <p className="mt-1 text-sm text-muted-foreground">{email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.firstName")}
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.lastName")}
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.email")}
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.phone")}
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("form.message")}
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="mt-2 h-24 w-full resize-none border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
                  required
                />
              </div>

              <Button
                type="submit"
                className="mt-4 w-full rounded-full bg-foreground py-6 text-background hover:bg-foreground/90 md:w-auto md:px-12"
              >
                {t("form.submit")}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}
