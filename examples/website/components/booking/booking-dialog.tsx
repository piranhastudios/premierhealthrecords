"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, CheckCircle2, ClipboardList, Clock, CreditCard, MapPin, Smartphone, Stethoscope, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  /** Clinic phone shown when online booking is unavailable. */
  phone?: string | null
}

type Slot = { start: string; end: string }
type Booked = { start: string; end: string }
type BookingResponse = {
  appointmentId: string
  start: string
  end: string
  requiresPayment: boolean
  invoiceId?: string
  amount?: number
  currency?: string
}
/** How long the server holds an unpaid booking; mirrors HOLD_MINUTES in lib/medplum.ts. */
const HOLD_MINUTES = 15

const CLINIC_TIMEZONE = "Africa/Douala"
// Every step shares this wrapper so the dialog does not jump in height as the
// visitor moves from choosing a service to picking a time and filling details.
const STEP = "flex min-h-[19rem] min-w-0 flex-col gap-3 pt-1"

/**
 * Site → service → doctor → time → details. Steps with a single choice are
 * skipped automatically, so a one-site clinic with one doctor goes straight to
 * the times. Availability and booking go through /api/booking (Medplum).
 */
export function BookingDialog({ sites, phone }: Props) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [siteId, setSiteId] = useState<string | undefined>(sites.length === 1 ? sites[0].id : undefined)
  const [specialty, setSpecialty] = useState<string | undefined>()
  const [practitionerId, setPractitionerId] = useState<string | undefined>()
  const [serviceId, setServiceId] = useState<string | undefined>()
  const [slot, setSlot] = useState<Slot | undefined>()
  const [pending, setPending] = useState<BookingResponse | undefined>()
  const [booked, setBooked] = useState<Booked | undefined>()

  const site = useMemo(() => sites.find((s) => s.id === siteId), [sites, siteId])

  // Patients choose a specialty first ("Consultant Cardiologist"), then the
  // clinician, then the kind of appointment. Clinicians with no specialty
  // recorded share one unnamed bucket, which auto-skips.
  const specialties = useMemo(
    () => Array.from(new Set((site?.practitioners ?? []).map((p) => p.specialty ?? ""))).sort(),
    [site],
  )
  const doctors = useMemo(
    () => (site?.practitioners ?? []).filter((p) => specialty === undefined || (p.specialty ?? "") === specialty),
    [site, specialty],
  )
  const practitioner = doctors.find((p) => p.id === practitionerId)
  const services = useMemo(
    () => (site?.services ?? []).filter((s) => practitioner?.serviceIds.includes(s.id)),
    [site, practitioner],
  )
  const serviceName = services.find((s) => s.id === serviceId)?.name

  // Auto-advance any step that has only one option.
  useEffect(() => {
    if (site && specialties.length === 1 && specialty === undefined) {
      setSpecialty(specialties[0])
    }
  }, [site, specialties, specialty])
  useEffect(() => {
    if (specialty !== undefined && doctors.length === 1 && !practitionerId) {
      setPractitionerId(doctors[0].id)
    }
  }, [specialty, doctors, practitionerId])
  useEffect(() => {
    if (practitioner && services.length === 1 && !serviceId) {
      setServiceId(services[0].id)
    }
  }, [practitioner, services, serviceId])

  function reset(level: "site" | "specialty" | "doctor" | "service" | "time") {
    setBooked(undefined)
    if (level === "site") {
      setSiteId(sites.length === 1 ? sites[0].id : undefined)
    }
    if (level === "site" || level === "specialty") {
      setSpecialty(undefined)
    }
    if (level === "site" || level === "specialty" || level === "doctor") {
      setPractitionerId(undefined)
    }
    if (level !== "time") {
      setServiceId(undefined)
    }
    setSlot(undefined)
    setPending(undefined)
  }

  const dateTime = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })

  if (booked) {
    return (
      <div className="flex min-h-[19rem] flex-col items-center justify-center gap-3 py-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-accent" />
        <h3 className="font-serif text-2xl">{t("successTitle")}</h3>
        <p className="text-base font-medium text-foreground">{dateTime.format(new Date(booked.start))}</p>
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
      <div className={STEP}>
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

  if (site.practitioners.length === 0) {
    return (
      <div className={STEP}>
        {sites.length > 1 && <BackLink onClick={() => reset("site")} label={t("back")} />}
        <Unavailable phone={phone} />
      </div>
    )
  }

  const backToSite = sites.length > 1 ? () => reset("site") : undefined

  // Step 2: specialty
  if (specialty === undefined) {
    return (
      <div className={STEP}>
        <Crumbs items={[site.name]} onBack={backToSite} backLabel={t("back")} />
        <StepTitle icon={<Stethoscope className="h-4 w-4" />}>{t("pickSpecialty")}</StepTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {specialties.map((value) => {
            const count = (site.practitioners ?? []).filter((p) => (p.specialty ?? "") === value).length
            return (
              <li key={value || "other"}>
                <ChoiceButton
                  onClick={() => setSpecialty(value)}
                  title={value || t("otherSpecialty")}
                  subtitle={t("doctorCount", { count })}
                />
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const specialtyLabel = specialty || t("otherSpecialty")
  const backToSpecialty = specialties.length > 1 ? () => reset("specialty") : backToSite

  // Step 3: clinician
  if (!practitioner) {
    return (
      <div className={STEP}>
        <Crumbs items={[site.name, specialtyLabel]} onBack={backToSpecialty} backLabel={t("back")} />
        <StepTitle icon={<UserRound className="h-4 w-4" />}>{t("pickDoctor")}</StepTitle>
        <ul className="grid gap-2">
          {doctors.map((doctor) => (
            <li key={doctor.id}>
              <ChoiceButton onClick={() => setPractitionerId(doctor.id)} title={doctor.name} subtitle={doctor.specialty} />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const backToDoctor = doctors.length > 1 ? () => reset("doctor") : backToSpecialty

  // Step 4: appointment type
  if (!serviceId) {
    return (
      <div className={STEP}>
        <Crumbs items={[site.name, specialtyLabel, practitioner.name]} onBack={backToDoctor} backLabel={t("back")} />
        <StepTitle icon={<ClipboardList className="h-4 w-4" />}>{t("pickService")}</StepTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {services.map((service) => (
            <li key={service.id}>
              <ChoiceButton
                onClick={() => setServiceId(service.id)}
                title={service.name}
                subtitle={
                  service.price
                    ? formatAmount(service.price.value, service.price.currency, locale)
                    : t("freeService")
                }
              />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const crumbs = [site.name, practitioner.name, serviceName]
  const backToService = services.length > 1 ? () => reset("service") : backToDoctor

  // Step 5: time
  if (!slot) {
    return (
      <div className={STEP}>
        <Crumbs items={crumbs} onBack={backToService} backLabel={t("back")} />
        <StepTitle icon={<Clock className="h-4 w-4" />}>{t("pickTime")}</StepTitle>
        <TimePicker scheduleId={practitioner.scheduleId} serviceId={serviceId} locale={locale} onPick={setSlot} phone={phone} />
      </div>
    )
  }

  // Step 6: details
  return (
    <div className={STEP}>
      <Crumbs items={[...crumbs, dateTime.format(new Date(slot.start))]} onBack={() => reset("time")} backLabel={t("back")} />
      {pending?.requiresPayment && pending.invoiceId ? (
        <PaymentStep booking={pending} locale={locale} onPaid={(b) => setBooked(b)} />
      ) : (
        <DetailsForm
          scheduleId={practitioner.scheduleId}
          serviceId={serviceId}
          slot={slot}
          locale={locale}
          onBooked={(result) => {
            if (result.requiresPayment && result.invoiceId) {
              setPending(result)
            } else {
              setBooked({ start: result.start, end: result.end })
            }
          }}
          onTaken={() => setSlot(undefined)}
        />
      )}
    </div>
  )
}

function formatAmount(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "XAF" ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

/**
 * Take the booking fee. The appointment is already held as `pending`; paying is what
 * confirms it. Card sends the patient to a hosted checkout and they come back to
 * /booking/complete; mobile money prompts their phone and we poll for the result.
 */
function PaymentStep({
  booking,
  locale,
  onPaid,
}: {
  booking: BookingResponse
  locale: string
  onPaid: (booked: Booked) => void
}) {
  const t = useTranslations("booking")
  const [method, setMethod] = useState<"card" | "momo" | undefined>()
  const [phase, setPhase] = useState<"choose" | "starting" | "waiting">("choose")
  const [error, setError] = useState<string | undefined>()
  const amount = formatAmount(booking.amount ?? 0, booking.currency ?? "XAF", locale)

  // Poll while the patient approves the prompt on their phone.
  useEffect(() => {
    if (phase !== "waiting" || !booking.invoiceId) {
      return
    }
    let active = true
    let tries = 0
    const timer = setInterval(async () => {
      tries += 1
      try {
        const res = await fetch(`/api/booking/status?invoice=${encodeURIComponent(booking.invoiceId as string)}`)
        const json = (await res.json()) as { paid?: boolean }
        if (json.paid && active) {
          clearInterval(timer)
          onPaid({ start: booking.start, end: booking.end })
          return
        }
      } catch {
        // keep polling; a transient failure is not an answer
      }
      if (tries >= 40 && active) {
        clearInterval(timer)
        setPhase("choose")
        setError(t("payPending"))
      }
    }, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [phase, booking, onPaid, t])

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPhase("starting")
    setError(undefined)
    try {
      const res = await fetch("/api/booking/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: booking.invoiceId,
          method,
          phone: form.get("phone"),
          correspondent: form.get("correspondent"),
        }),
      })
      if (!res.ok) {
        setPhase("choose")
        setError(t("payFailedStart"))
        return
      }
      const json = (await res.json()) as { checkoutUrl?: string }
      if (json.checkoutUrl) {
        window.location.assign(json.checkoutUrl)
        return
      }
      setPhase("waiting")
    } catch {
      setPhase("choose")
      setError(t("payFailedStart"))
    }
  }

  if (phase === "waiting") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Smartphone className="h-10 w-10 animate-pulse text-accent" />
        <p className="text-sm font-medium text-foreground">{t("payWaiting")}</p>
        <p className="text-xs text-muted-foreground">{amount}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StepTitle icon={<CreditCard className="h-4 w-4" />}>{t("payTitle")}</StepTitle>
      <div className="rounded-xl border border-border bg-accent/5 p-4">
        <p className="text-xs text-muted-foreground">{t("payAmount")}</p>
        <p className="text-2xl font-semibold text-foreground">{amount}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("payHeld", { minutes: HOLD_MINUTES })}</p>
      </div>

      {!method ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("payMethod")}</p>
          <ChoiceButton onClick={() => setMethod("momo")} title={t("payMomo")} subtitle={t("payMomoHint")} />
          <ChoiceButton onClick={() => setMethod("card")} title={t("payCard")} subtitle={t("payCardHint")} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <form onSubmit={start} className="space-y-4">
          {method === "momo" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="payPhone">{t("payPhone")}</Label>
                <Input id="payPhone" name="phone" type="tel" placeholder="+237 6 XX XX XX XX" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="correspondent">{t("payProvider")}</Label>
                <select
                  id="correspondent"
                  name="correspondent"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="MTN_MOMO_CMR">MTN Mobile Money</option>
                  <option value="ORANGE_CMR">Orange Money</option>
                </select>
              </div>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={phase === "starting"} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
            {phase === "starting" ? t("payStarting") : t("payNow", { amount })}
          </Button>
          <button type="button" onClick={() => { setMethod(undefined); setError(undefined) }} className="w-full text-sm text-accent hover:underline">
            {t("payChangeMethod")}
          </button>
        </form>
      )}
    </div>
  )
}

function TimePicker({
  scheduleId,
  serviceId,
  locale,
  onPick,
  phone,
}: {
  scheduleId: string
  serviceId: string
  locale: string
  onPick: (slot: Slot) => void
  phone?: string | null
}) {
  const t = useTranslations("booking")
  const [slots, setSlots] = useState<Slot[] | undefined>()
  const [failed, setFailed] = useState(false)
  const [day, setDay] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    setSlots(undefined)
    setFailed(false)
    fetch(`/api/booking/availability?schedule=${encodeURIComponent(scheduleId)}&service=${encodeURIComponent(serviceId)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status))
        }
        const json = (await res.json()) as { slots: Slot[] }
        if (active) {
          setSlots(json.slots)
        }
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [scheduleId, serviceId])

  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
  const dayLabel = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: CLINIC_TIMEZONE, weekday: "short", day: "numeric", month: "short" })
  const timeLabel = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: CLINIC_TIMEZONE, hour: "2-digit", minute: "2-digit" })

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots ?? []) {
      const key = dayKey.format(new Date(s.start))
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots])
  const days = Array.from(byDay.keys())
  const activeDay = day && byDay.has(day) ? day : days[0]

  if (failed) {
    return <Unavailable phone={phone} />
  }
  if (!slots) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
  }
  if (days.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("noTimes")}</p>
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setDay(key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              key === activeDay ? "border-accent bg-accent text-accent-foreground" : "border-input bg-background hover:border-accent"
            }`}
          >
            {dayLabel.format(new Date(byDay.get(key)![0].start))}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={t("pickTime")} className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
        {(byDay.get(activeDay as string) ?? []).map((s) => (
          <button
            key={s.start}
            type="button"
            role="radio"
            aria-checked={false}
            onClick={() => onPick(s)}
            className="rounded-md border border-input bg-background px-2 py-2 text-sm transition-colors hover:border-accent hover:text-accent"
          >
            {timeLabel.format(new Date(s.start))}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailsForm({
  scheduleId,
  serviceId,
  slot,
  locale,
  onBooked,
  onTaken,
}: {
  scheduleId: string
  serviceId: string
  slot: Slot
  locale: string
  onBooked: (result: BookingResponse) => void
  onTaken: () => void
}) {
  const t = useTranslations("booking")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setError(undefined)
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          serviceId,
          start: slot.start,
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          phone: form.get("phone"),
          email: form.get("email"),
          notes: form.get("notes"),
          website: form.get("website"),
          locale,
        }),
      })
      if (res.status === 409) {
        setError(t("taken"))
        setTimeout(onTaken, 1500)
        return
      }
      if (!res.ok) {
        setError(res.status === 400 ? t("checkDetails") : t("failed"))
        return
      }
      const json = (await res.json()) as BookingResponse
      onBooked(json)
    } catch {
      setError(t("failed"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <StepTitle icon={<UserRound className="h-4 w-4" />}>{t("yourDetails")}</StepTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t("firstName")}</Label>
          <Input id="firstName" name="firstName" autoComplete="given-name" required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">{t("lastName")}</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" required maxLength={80} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+237 6 XX XX XX XX" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          placeholder={t("notesPlaceholder")}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{t("consent")}</p>
      <Button type="submit" disabled={submitting} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
        {submitting ? t("booking") : t("confirm")}
      </Button>
    </form>
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

function Crumbs({ items, onBack, backLabel }: { items: (string | undefined)[]; onBack?: () => void; backLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{items.filter(Boolean).join(" · ")}</p>
      {onBack && <BackLink onClick={onBack} label={backLabel} />}
    </div>
  )
}
