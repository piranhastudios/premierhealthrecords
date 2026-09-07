/**
 * Server-only Medplum client for the website booking flow.
 *
 * The website talks to Medplum with a scoped client_credentials
 * ClientApplication (scripts/seed-website-client.mjs): it reads which doctors and
 * services each site offers, asks `Schedule/$find` for real availability, and books
 * with `Appointment/$book` (which rejects double bookings). Confirmation messages
 * are sent by the Medplum bots, and staff see every booking on the provider app's
 * Schedule page and dashboard.
 *
 * Env: MEDPLUM_BASE_URL (ends with /), MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET.
 * Without them the dialog falls back to "call us" — the site still builds.
 */

const BASE_URL = process.env.MEDPLUM_BASE_URL?.replace(/\/?$/, "/")
const CLIENT_ID = process.env.MEDPLUM_CLIENT_ID
const CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET

const SERVICE_TYPE_REFERENCE_URL = "https://medplum.com/fhir/service-type-reference"
/** HealthcareService extension pointing at the ChargeItemDefinition that prices it. */
const PRICE_EXT = "https://premierhealth.cm/fhir/StructureDefinition/service-price"
/** Stable per-site business identifier, seeded as the site slug (e.g. "douala-grand-mall"). */
const SITE_IDENTIFIER_SYSTEM = "https://premierhealth.cm/fhir/sid/site"
/** Ties a booking fee invoice back to the appointment it is holding. */
const INVOICE_APPOINTMENT_SYSTEM = "https://premierhealth.cm/fhir/sid/booking-appointment"
/** How long an unpaid booking holds its slot before the time is released. */
export const HOLD_MINUTES = 15
const APPOINTMENT_SOURCE_SYSTEM = "https://premierhealth.cm/fhir/CodeSystem/appointment-source"
const PATIENT_SOURCE_SYSTEM = "https://premierhealth.cm/fhir/CodeSystem/patient-source"
const CACHE_TTL_MS = 5 * 60 * 1000
const DIRECTORY_REVALIDATE = 300
const DEFAULT_COUNTRY_CODE = "237"
// Server maximum for $find is 31 days; the dialog shows two weeks.
export const BOOKING_WINDOW_DAYS = 14
// Don't offer slots starting in the next 30 minutes.
const MIN_NOTICE_MS = 30 * 60_000

/**
 * Master switch for online booking, independent of whether credentials exist.
 *
 * Opt-in on purpose: booking now raises invoices and takes payment, so it must never
 * turn itself on because a credential happened to be present. Unset means off.
 * Set BOOKING_ENABLED=true per environment in Vercel.
 *
 * When off the site behaves as though no clinician is bookable: the dialog shows the
 * "call us" fallback with the clinic phone number, and the booking API routes return
 * 503, so it cannot be driven directly either.
 */
const bookingFlagOn = /^(1|true|on|yes)$/i.test(process.env.BOOKING_ENABLED ?? "")

export const bookingEnabled = bookingFlagOn && Boolean(BASE_URL && CLIENT_ID && CLIENT_SECRET)

/** Why booking is off, for the server log — a silent switch is hard to debug. */
export function bookingDisabledReason(): string | undefined {
  if (!bookingFlagOn) {
    return "BOOKING_ENABLED is not set to true"
  }
  if (!BASE_URL || !CLIENT_ID || !CLIENT_SECRET) {
    return "MEDPLUM_BASE_URL / MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET are not all set"
  }
  return undefined
}

export type BookingPractitioner = {
  id: string
  name: string
  /** Shown to patients and used as the first booking step, e.g. "Consultant Cardiologist". */
  specialty?: string
  /** The (doctor × site) Schedule that availability and booking run against. */
  scheduleId: string
  serviceIds: string[]
}

export type BookingService = {
  id: string
  name: string
  /** What this service costs to book. Absent means free — no payment is asked for. */
  price?: { value: number; currency: string }
}

export type SiteDirectory = {
  fhirLocationId: string
  practitioners: BookingPractitioner[]
  services: BookingService[]
}

export type AvailableSlot = { start: string; end: string }

export type BookingRequest = {
  scheduleId: string
  serviceId: string
  start: string
  firstName: string
  lastName: string
  phone: string
  email?: string
  notes?: string
  locale?: string
}

export type BookingResult = {
  appointmentId: string
  start: string
  end: string
  /** True when the service has a price and the booking is held until it is paid. */
  requiresPayment: boolean
  invoiceId?: string
  amount?: number
  currency?: string
}

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type FhirResource = {
  resourceType: string
  id?: string
  name?: unknown
  active?: boolean
  status?: string
  identifier?: { system?: string; value?: string }[]
  actor?: { reference?: string; display?: string }[]
  serviceType?: { extension?: { url?: string; valueReference?: { reference?: string } }[] }[]
  type?: { text?: string; coding?: { display?: string }[] }[]
  qualification?: { code?: { text?: string; coding?: { display?: string }[] } }[]
  url?: unknown
  extension?: { url?: string; valueCanonical?: string }[]
  propertyGroup?: { priceComponent?: { type?: string; amount?: { value?: number; currency?: string } }[] }[]
  start?: string
  end?: string
  [key: string]: unknown
}

type Bundle = { resourceType?: string; entry?: { resource?: FhirResource }[]; issue?: { details?: { text?: string } }[] }

let tokenCache: { value: string; expiresAt: number } | undefined
const directoryCache = new Map<string, { value: SiteDirectory; expiresAt: number }>()

/**
 * `revalidate` keeps directory reads cacheable so rendering a page that shows the
 * header does not opt the whole route out of static rendering; the booking routes
 * pass 0 (always fresh).
 */
async function getToken(revalidate: number): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.value
  }
  const response = await fetch(`${BASE_URL}oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID as string,
      client_secret: CLIENT_SECRET as string,
    }),
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
  })
  if (!response.ok) {
    throw new Error(`Medplum token request failed: ${response.status}`)
  }
  const json = (await response.json()) as { access_token: string; expires_in?: number }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 }
  return json.access_token
}

async function fhir<T = FhirResource>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  revalidate = 0,
): Promise<T> {
  const token = await getToken(revalidate)
  const response = await fetch(`${BASE_URL}fhir/R4/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/fhir+json",
      ...(body !== undefined ? { "Content-Type": "application/fhir+json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
  })
  const text = await response.text()
  const json = text ? (JSON.parse(text) as T & Bundle) : ({} as T & Bundle)
  if (!response.ok) {
    const detail = json?.issue?.[0]?.details?.text ?? `${response.status}`
    throw new BookingError(`Medplum ${method} ${path.split("?")[0]} failed: ${detail}`, response.status)
  }
  return json
}

async function search(resourceType: string, query: string, revalidate = 0): Promise<FhirResource[]> {
  const bundle = await fhir<Bundle>("GET", `${resourceType}?${query}`, undefined, revalidate)
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is FhirResource => Boolean(r))
}

function humanName(resource: FhirResource): string {
  const names = resource.name as { text?: string; prefix?: string[]; given?: string[]; family?: string }[] | undefined
  const name = names?.[0]
  if (!name) {
    return ""
  }
  return name.text ?? [name.prefix?.join(" "), name.given?.join(" "), name.family].filter(Boolean).join(" ")
}

/** The base price on a ChargeItemDefinition, if an amount has been set. */
function basePriceOf(definition: FhirResource): { value: number; currency: string } | undefined {
  for (const group of definition.propertyGroup ?? []) {
    for (const component of group.priceComponent ?? []) {
      if (component.type === "base" && typeof component.amount?.value === "number") {
        return { value: component.amount.value, currency: component.amount.currency ?? "XAF" }
      }
    }
  }
  return undefined
}

/** The clinician's specialty, stamped on Practitioner.qualification by the site seed. */
function specialtyOf(practitioner: FhirResource | undefined): string | undefined {
  const q = practitioner?.qualification?.[0]?.code
  return q?.text ?? q?.coding?.[0]?.display ?? undefined
}

function serviceIdsOf(schedule: FhirResource): string[] {
  return (schedule.serviceType ?? [])
    .map((concept) => concept.extension?.find((e) => e.url === SERVICE_TYPE_REFERENCE_URL)?.valueReference?.reference)
    .filter((ref): ref is string => Boolean(ref))
    .map((ref) => ref.split("/")[1])
}

/** E.164-ish normalisation matching the bots' lib/phone.ts (default country Cameroon). */
export function normalizePhone(value: string): string {
  const v = value.replace(/[\s()\-.]/g, "")
  if (v.startsWith("+")) {
    return v
  }
  if (v.startsWith("00")) {
    return `+${v.slice(2)}`
  }
  return `+${DEFAULT_COUNTRY_CODE}${v.replace(/^0+/, "")}`
}

/**
 * Doctors and services bookable at one site, joined from the FHIR Schedules
 * (practitioner × site) and HealthcareServices of that Location.
 */
/**
 * Resolve a site to its Location id in whichever Medplum project this environment
 * points at. Sites are matched on their slug, not a raw id, so one CMS document
 * works against both the live project and the dev one.
 */
async function resolveLocationId(site: string): Promise<string | undefined> {
  const [bySlug] = await search(
    "Location",
    `identifier=${encodeURIComponent(`${SITE_IDENTIFIER_SYSTEM}|${site}`)}&_count=1`,
    DIRECTORY_REVALIDATE
  ).catch(() => [])
  if (bySlug?.id) {
    return bySlug.id
  }
  // Fall back to treating the value as a raw Location id, for a site recorded
  // before slugs were seeded.
  const direct = await fhir("GET", `Location/${site}`, undefined, DIRECTORY_REVALIDATE).catch(() => undefined)
  return direct?.id
}

export async function getSiteDirectory(site: string): Promise<SiteDirectory> {
  const empty: SiteDirectory = { fhirLocationId: site, practitioners: [], services: [] }
  if (!bookingEnabled) {
    return empty
  }
  const cached = directoryCache.get(site)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  try {
    const fhirLocationId = await resolveLocationId(site)
    if (!fhirLocationId) {
      console.error(`No Location matches site "${site}" in this project`)
      return empty
    }
    const [scheduleEntries, serviceResources] = await Promise.all([
      search("Schedule", `actor=Location/${fhirLocationId}&active=true&_count=100&_include=Schedule:actor`, DIRECTORY_REVALIDATE),
      search("HealthcareService", `location=Location/${fhirLocationId}&active=true&_count=100&_sort=name`, DIRECTORY_REVALIDATE),
    ])
    const practitionersById = new Map<string, FhirResource>()
    for (const resource of scheduleEntries) {
      if (resource.resourceType === "Practitioner" && resource.id) {
        practitionersById.set(resource.id, resource)
      }
    }
    const practitioners: BookingPractitioner[] = []
    for (const schedule of scheduleEntries) {
      if (schedule.resourceType !== "Schedule" || !schedule.id) {
        continue
      }
      const practitionerRef = schedule.actor?.find((a) => a.reference?.startsWith("Practitioner/"))
      const practitionerId = practitionerRef?.reference?.split("/")[1]
      if (!practitionerId) {
        continue
      }
      const practitioner = practitionersById.get(practitionerId)
      const serviceIds = serviceIdsOf(schedule)
      if (serviceIds.length === 0) {
        continue
      }
      practitioners.push({
        id: practitionerId,
        name: (practitioner && humanName(practitioner)) || practitionerRef?.display || "Doctor",
        specialty: specialtyOf(practitioner),
        scheduleId: schedule.id,
        serviceIds,
      })
    }
    practitioners.sort((a, b) => a.name.localeCompare(b.name))

    // Prices live on ChargeItemDefinitions the services point at. One search for
    // the lot, then match by canonical url.
    const priceUrls = Array.from(
      new Set(
        serviceResources
          .map((s) => s.extension?.find((e) => e.url === PRICE_EXT)?.valueCanonical)
          .filter((url): url is string => Boolean(url))
      )
    )
    const priceByUrl = new Map<string, { value: number; currency: string }>()
    if (priceUrls.length > 0) {
      const definitions = await search(
        "ChargeItemDefinition",
        `url=${priceUrls.map(encodeURIComponent).join(",")}&_count=100`,
        DIRECTORY_REVALIDATE
      ).catch(() => [])
      for (const definition of definitions) {
        const price = basePriceOf(definition)
        const url = typeof definition.url === "string" ? definition.url : undefined
        if (url && price) {
          priceByUrl.set(url, price)
        }
      }
    }

    const services: BookingService[] = serviceResources
      .filter((s) => s.id)
      .map((s) => {
        const priceUrl = s.extension?.find((e) => e.url === PRICE_EXT)?.valueCanonical
        return {
          id: s.id as string,
          name: (typeof s.name === "string" && s.name) || s.type?.[0]?.text || s.type?.[0]?.coding?.[0]?.display || "Service",
          ...(priceUrl && priceByUrl.has(priceUrl) ? { price: priceByUrl.get(priceUrl) } : {}),
        }
      })

    const value = { fhirLocationId, practitioners, services }
    directoryCache.set(site, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  } catch (error) {
    console.error(`Booking directory unavailable for site "${site}":`, error)
    return empty
  }
}

/** Directories for several sites, keyed by the site key that was passed in. */
export async function getBookingDirectory(sites: string[]): Promise<Record<string, SiteDirectory>> {
  const unique = Array.from(new Set(sites.filter(Boolean)))
  const directories = await Promise.all(unique.map(async (site) => [site, await getSiteDirectory(site)] as const))
  return Object.fromEntries(directories)
}

/** Raw free Slot resources from Schedule/$find for the booking window. */
async function findSlots(scheduleId: string, serviceId: string, from = new Date()): Promise<FhirResource[]> {
  const start = new Date(Math.max(from.getTime(), Date.now() + MIN_NOTICE_MS))
  const end = new Date(start.getTime() + BOOKING_WINDOW_DAYS * 86_400_000)
  const params = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    "service-type-reference": `HealthcareService/${serviceId}`,
    // Server maximum; two weeks at a 15-minute grid is ~560 slots.
    _count: "1000",
  })
  const bundle = await fhir<Bundle>("GET", `Schedule/${scheduleId}/$find?${params}`)
  return (bundle.entry ?? []).map((e) => e.resource).filter((r): r is FhirResource => Boolean(r))
}

export async function findAvailability(scheduleId: string, serviceId: string): Promise<AvailableSlot[]> {
  const slots = await findSlots(scheduleId, serviceId)
  return slots
    .filter((s) => s.start && s.end)
    .map((s) => ({ start: s.start as string, end: s.end as string }))
}

async function findOrCreatePatient(req: BookingRequest): Promise<FhirResource> {
  const phone = normalizePhone(req.phone)
  const email = req.email?.trim().toLowerCase()
  const byPhone =
    (await search("Patient", `phone=${encodeURIComponent(phone)}&_count=1`))[0] ??
    (await search("Patient", `telecom=${encodeURIComponent(phone)}&_count=1`))[0]
  if (byPhone) {
    return byPhone
  }
  if (email) {
    const byEmail = (await search("Patient", `email=${encodeURIComponent(email)}&_count=1`))[0]
    if (byEmail) {
      return byEmail
    }
  }
  return fhir("POST", "Patient", {
    resourceType: "Patient",
    active: true,
    name: [{ given: [req.firstName.trim()], family: req.lastName.trim() }],
    telecom: [
      { system: "phone", value: phone, use: "mobile" },
      ...(email ? [{ system: "email", value: email }] : []),
    ],
    ...(req.locale ? { communication: [{ language: { coding: [{ system: "urn:ietf:bcp:47", code: req.locale }] } }] } : {}),
    meta: { tag: [{ system: PATIENT_SOURCE_SYSTEM, code: "website" }] },
  })
}

/**
 * Book one of the offered slots. The slot is re-derived from $find on the server so
 * a tampered request cannot book outside availability; $book itself rejects a slot
 * taken in the meantime (409).
 */
export async function bookAppointment(req: BookingRequest): Promise<BookingResult> {
  const wanted = new Date(req.start)
  if (Number.isNaN(wanted.getTime())) {
    throw new BookingError("Invalid start time", 400)
  }
  // Free any expired unpaid holds on this diary first, so an abandoned payment
  // does not keep a time off the calendar.
  await releaseExpiredHolds(req.scheduleId).catch((error) => console.error("Hold sweep failed:", error))

  const slots = await findSlots(req.scheduleId, req.serviceId, new Date(wanted.getTime() - 60_000))
  const slot = slots.find((s) => s.start && new Date(s.start).getTime() === wanted.getTime())
  if (!slot) {
    throw new BookingError("That time is no longer available", 409)
  }

  const price = await getServicePrice(req.serviceId)
  const patient = await findOrCreatePatient(req)
  const bundle = await fhir<Bundle>("POST", "Appointment/$book", {
    resourceType: "Parameters",
    parameter: [
      { name: "slot", resource: slot },
      { name: "patient-reference", valueReference: { reference: `Patient/${patient.id}` } },
    ],
  })
  const appointment = (bundle.entry ?? []).map((e) => e.resource).find((r) => r?.resourceType === "Appointment")
  if (!appointment?.id) {
    throw new BookingError("Booking did not return an appointment", 502)
  }

  // Record where it came from and what the patient told us. A booking that has to
  // be paid for is held as `pending` until the money arrives; the busy slot keeps
  // the time reserved meanwhile.
  const notes = req.notes?.trim().slice(0, 1000)
  const requiresPayment = Boolean(price && price.value > 0)
  await fhir("PUT", `Appointment/${appointment.id}`, {
    ...appointment,
    ...(requiresPayment ? { status: "pending" } : {}),
    ...(notes ? { comment: notes } : {}),
    meta: { ...((appointment.meta as object) ?? {}), tag: [{ system: APPOINTMENT_SOURCE_SYSTEM, code: "website" }] },
  }).catch((error) => console.error("Could not annotate website booking:", error))

  const result: BookingResult = {
    appointmentId: appointment.id,
    start: appointment.start as string,
    end: appointment.end as string,
    requiresPayment,
  }
  if (!requiresPayment || !price) {
    return result
  }

  const invoice = await fhir("POST", "Invoice", {
    resourceType: "Invoice",
    status: "issued",
    identifier: [{ system: INVOICE_APPOINTMENT_SYSTEM, value: appointment.id }],
    subject: { reference: `Patient/${patient.id}` },
    date: new Date().toISOString(),
    totalNet: { value: price.value, currency: price.currency },
    totalGross: { value: price.value, currency: price.currency },
    lineItem: [
      {
        sequence: 1,
        chargeItemCodeableConcept: { text: price.serviceName },
        priceComponent: [{ type: "base", amount: { value: price.value, currency: price.currency } }],
      },
    ],
  })
  return { ...result, invoiceId: invoice.id, amount: price.value, currency: price.currency }
}

/** The price of a service, or undefined when it is free to book. */
async function getServicePrice(
  serviceId: string
): Promise<{ value: number; currency: string; serviceName: string } | undefined> {
  const service = await fhir("GET", `HealthcareService/${serviceId}`).catch(() => undefined)
  const priceUrl = service?.extension?.find((e) => e.url === PRICE_EXT)?.valueCanonical
  if (!priceUrl) {
    return undefined
  }
  const [definition] = await search("ChargeItemDefinition", `url=${encodeURIComponent(priceUrl)}&_count=1`)
  const price = definition ? basePriceOf(definition) : undefined
  if (!price) {
    return undefined
  }
  const serviceName =
    (typeof service?.name === "string" && service.name) || service?.type?.[0]?.text || "Appointment"
  return { ...price, serviceName }
}

/**
 * Start a payment for a booking fee. Card returns a Stripe Checkout URL to send the
 * patient to; mobile money pushes a prompt to their phone and is then polled.
 */
export async function startPayment(input: {
  invoiceId: string
  method: "card" | "momo"
  phone?: string
  correspondent?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<{ checkoutUrl?: string; depositId?: string }> {
  if (input.method === "card") {
    if (!input.successUrl || !input.cancelUrl) {
      throw new BookingError("Missing return URLs", 400)
    }
    const out = await fhir<{ parameter?: { name: string; valueString?: string; valueUrl?: string }[] }>(
      "POST",
      `Invoice/${input.invoiceId}/$checkout`,
      {
        resourceType: "Parameters",
        parameter: [
          { name: "method", valueString: "card" },
          { name: "successUrl", valueUrl: input.successUrl },
          { name: "cancelUrl", valueUrl: input.cancelUrl },
        ],
      }
    )
    const checkoutUrl = out.parameter?.find((p) => p.name === "checkoutUrl")
    const url = checkoutUrl?.valueUrl ?? checkoutUrl?.valueString
    if (!url) {
      throw new BookingError("Payment provider did not return a checkout link", 502)
    }
    return { checkoutUrl: url }
  }

  if (!input.phone || !input.correspondent) {
    throw new BookingError("Missing phone number or provider", 400)
  }
  const out = await fhir<{ parameter?: { name: string; valueString?: string }[] }>(
    "POST",
    `Invoice/${input.invoiceId}/$pay`,
    {
      resourceType: "Parameters",
      parameter: [
        { name: "payerPhone", valueString: normalizePhone(input.phone).replace(/\D/g, "") },
        { name: "correspondent", valueString: input.correspondent },
      ],
    }
  )
  return { depositId: out.parameter?.find((p) => p.name === "depositId")?.valueString }
}

export type PaymentStatus = { paid: boolean; appointmentStatus?: string; start?: string }

/**
 * Whether a booking fee has been paid. Only the payment provider's own callback can
 * mark an invoice balanced, so this reads that outcome; when it is paid the held
 * appointment is confirmed.
 */
export async function getPaymentStatus(invoiceId: string): Promise<PaymentStatus> {
  const invoice = await fhir("GET", `Invoice/${invoiceId}`)
  const appointmentId = invoice.identifier?.find((i) => i.system === INVOICE_APPOINTMENT_SYSTEM)?.value
  const paid = invoice.status === "balanced"
  if (!appointmentId) {
    return { paid }
  }
  const appointment = await fhir("GET", `Appointment/${appointmentId}`).catch(() => undefined)
  if (paid && appointment && appointment.status === "pending") {
    const confirmed = await fhir("PUT", `Appointment/${appointmentId}`, { ...appointment, status: "booked" }).catch(
      (error) => {
        console.error("Could not confirm a paid booking:", error)
        return appointment
      }
    )
    return { paid, appointmentStatus: confirmed.status, start: confirmed.start }
  }
  return { paid, appointmentStatus: appointment?.status, start: appointment?.start }
}

/**
 * Cancel unpaid holds older than HOLD_MINUTES on a diary and free their slots, so an
 * abandoned payment does not keep a time off the calendar. Best-effort and cheap: it
 * runs on the way into a booking rather than needing a scheduled job.
 */
export async function releaseExpiredHolds(scheduleId: string): Promise<number> {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60_000).toISOString()
  const stale = await search("Appointment", `status=pending&date=ge${new Date().toISOString()}&_count=50`)
  let released = 0
  for (const appointment of stale) {
    if (!appointment.id || (appointment.meta as { lastUpdated?: string } | undefined)?.lastUpdated === undefined) {
      continue
    }
    if (((appointment.meta as { lastUpdated?: string }).lastUpdated as string) > cutoff) {
      continue
    }
    const slotRefs = ((appointment as { slot?: { reference?: string }[] }).slot ?? [])
      .map((r) => r.reference)
      .filter((r): r is string => Boolean(r))
    // Only touch holds on the diary being booked.
    const onThisSchedule = await Promise.all(
      slotRefs.map(async (ref) => {
        const slot = await fhir("GET", ref).catch(() => undefined)
        return (slot?.schedule as { reference?: string } | undefined)?.reference === `Schedule/${scheduleId}`
          ? { ref, slot }
          : undefined
      })
    )
    const mine = onThisSchedule.filter((x): x is { ref: string; slot: FhirResource } => Boolean(x))
    if (mine.length === 0) {
      continue
    }
    await fhir("PUT", `Appointment/${appointment.id}`, { ...appointment, status: "cancelled" }).catch(() => undefined)
    for (const { ref, slot } of mine) {
      await fhir("PUT", ref, { ...slot, status: "free" }).catch(() => undefined)
    }
    released++
  }
  return released
}
