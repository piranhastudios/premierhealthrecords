"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import Cal, { getCalApi } from "@calcom/embed-react"
import { ArrowLeft, CheckCircle2, MapPin, Stethoscope, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { BookingPractitioner, BookingService } from "@/lib/medplum"

export type BookingSite = {
  id: string
  name: string
  address?: string | null
  fhirLocationId: string
  practitioners: BookingPractitioner[]
  services: BookingService[]
}

type Props = {
  sites: BookingSite[]
  /** Public origin of the self-hosted Cal.diy, e.g. https://book.premierhealthcentrescameroon.com */
  calOrigin?: string | null
  /** Clinic phone shown when online booking is unavailable. */
  phone?: string | null
}

const CAL_NAMESPACE = "phc-booking"

/**
 * Site → service → doctor → Cal.diy booking page. Steps with a single choice
 * are skipped automatically, so a one-site clinic with one doctor goes straight
 * to the calendar.
 */
export function BookingDialog({ sites, calOrigin, phone }: Props) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [siteId, setSiteId] = useState<string | undefined>(sites.length === 1 ? sites[0].id : undefined)
  const [serviceId, setServiceId] = useState<string | undefined>()
  const [practitionerId, setPractitionerId] = useState<string | undefined>()
  const [done, setDone] = useState(false)

  const site = useMemo(() => sites.find((s) => s.id === siteId), [sites, siteId])
  const bookable = useMemo(() => site?.practitioners.filter((p) => p.calLink) ?? [], [site])
  const services = useMemo(
    () => (site?.services ?? []).filter((service) => bookable.some((p) => p.serviceIds.includes(service.id))),
    [site, bookable],
  )
  const doctors = useMemo(
    () => bookable.filter((p) => !serviceId || p.serviceIds.includes(serviceId)),
    [bookable, serviceId],
  )
  const practitioner = doctors.find((p) => p.id === practitionerId)

  // Auto-advance single-option steps.
  useEffect(() => {
    if (site && services.length === 1 && !serviceId) {
      setServiceId(services[0].id)
    }
  }, [site, services, serviceId])
  useEffect(() => {
    if (site && serviceId && doctors.length === 1 && !practitionerId) {
      setPractitionerId(doctors[0].id)
    }
  }, [site, serviceId, doctors, practitionerId])

  const origin = calOrigin?.replace(/\/+$/, "")
  const embedJsUrl = origin ? `${origin}/embed/embed.js` : undefined

  useEffect(() => {
    if (!practitioner || !origin) {
      return
    }
    let cancelled = false
    ;(async () => {
      const cal = await getCalApi({ namespace: CAL_NAMESPACE, embedJsUrl })
      if (cancelled) {
        return
      }
      cal("ui", { hideEventTypeDetails: false, layout: "month_view" })
      cal("on", {
        action: "bookingSuccessfulV2",
        callback: () => setDone(true),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [practitioner, origin, embedJsUrl])

  const onlineUnavailable = !origin || (site && bookable.length === 0)

  function reset(level: "site" | "service" | "doctor") {
    setDone(false)
    if (level === "site") {
      setSiteId(sites.length === 1 ? sites[0].id : undefined)
      setServiceId(undefined)
      setPractitionerId(undefined)
    } else if (level === "service") {
      setServiceId(undefined)
      setPractitionerId(undefined)
    } else {
      setPractitionerId(undefined)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-accent" />
        <h3 className="font-serif text-2xl">{t("successTitle")}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{t("successBody")}</p>
      </div>
    )
  }

  // Step 1: site
  if (!site) {
    if (sites.length === 0) {
      return <Unavailable phone={phone} />
    }
    return (
      <div className="space-y-3 pt-2">
        <StepTitle icon={<MapPin className="h-4 w-4" />}>{t("pickSite")}</StepTitle>
        <ul className="grid gap-2">
          {sites.map((candidate) => (
            <li key={candidate.id}>
              <ChoiceButton onClick={() => setSiteId(candidate.id)} title={candidate.name} subtitle={candidate.address} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (onlineUnavailable) {
    return (
      <div className="space-y-4 pt-2">
        {sites.length > 1 && <BackLink onClick={() => reset("site")} label={t("back")} />}
        <Unavailable phone={phone} />
      </div>
    )
  }

  // Step 2: service
  if (!serviceId) {
    return (
      <div className="space-y-3 pt-2">
        <Crumbs items={[site.name]} onBack={sites.length > 1 ? () => reset("site") : undefined} backLabel={t("back")} />
        <StepTitle icon={<Stethoscope className="h-4 w-4" />}>{t("pickService")}</StepTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {services.map((service) => (
            <li key={service.id}>
              <ChoiceButton onClick={() => setServiceId(service.id)} title={service.name} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // Step 3: doctor
  if (!practitioner) {
    const serviceName = services.find((s) => s.id === serviceId)?.name
    return (
      <div className="space-y-3 pt-2">
        <Crumbs items={[site.name, serviceName]} onBack={() => reset("service")} backLabel={t("back")} />
        <StepTitle icon={<UserRound className="h-4 w-4" />}>{t("pickDoctor")}</StepTitle>
        <ul className="grid gap-2">
          {doctors.map((doctor) => (
            <li key={doctor.id}>
              <ChoiceButton onClick={() => setPractitionerId(doctor.id)} title={doctor.name} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // Step 4: Cal.diy calendar
  const serviceName = services.find((s) => s.id === serviceId)?.name
  return (
    <div className="space-y-3 pt-2">
      <Crumbs
        items={[site.name, serviceName, practitioner.name]}
        onBack={() => reset(doctors.length > 1 ? "doctor" : services.length > 1 ? "service" : "site")}
        backLabel={t("back")}
      />
      <div className="h-[70vh] min-h-[520px] overflow-hidden rounded-xl border border-border">
        <Cal
          namespace={CAL_NAMESPACE}
          calLink={practitioner.calLink as string}
          calOrigin={origin}
          embedJsUrl={embedJsUrl}
          config={{
            layout: "month_view",
            theme: "light",
            // Prefills the required `service` booking question (value = HealthcareService id).
            service: serviceId,
            ...(locale === "fr" ? { locale: "fr" } : {}),
          }}
          style={{ width: "100%", height: "100%", overflow: "auto" }}
        />
      </div>
    </div>
  )
}

function Unavailable({ phone }: { phone?: string | null }) {
  const t = useTranslations("booking")
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      {phone && (
        <Button asChild className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
          <a href={`tel:${phone.replace(/\s+/g, "")}`}>{t("call", { phone })}</a>
        </Button>
      )}
    </div>
  )
}

function StepTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
      <span className="text-accent">{icon}</span>
      {children}
    </p>
  )
}

function ChoiceButton({ onClick, title, subtitle }: { onClick: () => void; title: string; subtitle?: string | null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-input bg-background px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent/5"
    >
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      {subtitle && <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>}
    </button>
  )
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function Crumbs({
  items,
  onBack,
  backLabel,
}: {
  items: (string | undefined)[]
  onBack?: () => void
  backLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{items.filter(Boolean).join(" · ")}</p>
      {onBack && <BackLink onClick={onBack} label={backLabel} />}
    </div>
  )
}
