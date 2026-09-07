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
const APPOINTMENT_SOURCE_SYSTEM = "https://premierhealth.cm/fhir/CodeSystem/appointment-source"
const PATIENT_SOURCE_SYSTEM = "https://premierhealth.cm/fhir/CodeSystem/patient-source"
const CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_COUNTRY_CODE = "237"
// Server maximum for $find is 31 days; the dialog shows two weeks.
export const BOOKING_WINDOW_DAYS = 14
// Don't offer slots starting in the next 30 minutes.
const MIN_NOTICE_MS = 30 * 60_000

export const bookingEnabled = Boolean(BASE_URL && CLIENT_ID && CLIENT_SECRET)

export type BookingPractitioner = {
  id: string
  name: string
  /** The (doctor × site) Schedule that availability and booking run against. */
  scheduleId: string
  serviceIds: string[]
}

export type BookingService = {
  id: string
  name: string
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

export type BookingResult = { appointmentId: string; start: string; end: string }

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
  start?: string
  end?: string
  [key: string]: unknown
}

type Bundle = { resourceType?: string; entry?: { resource?: FhirResource }[]; issue?: { details?: { text?: string } }[] }

let tokenCache: { value: string; expiresAt: number } | undefined
const directoryCache = new Map<string, { value: SiteDirectory; expiresAt: number }>()

async function getToken(): Promise<string> {
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
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`Medplum token request failed: ${response.status}`)
  }
  const json = (await response.json()) as { access_token: string; expires_in?: number }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 }
  return json.access_token
}

async function fhir<T = FhirResource>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const token = await getToken()
  const response = await fetch(`${BASE_URL}fhir/R4/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/fhir+json",
      ...(body !== undefined ? { "Content-Type": "application/fhir+json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  })
  const text = await response.text()
  const json = text ? (JSON.parse(text) as T & Bundle) : ({} as T & Bundle)
  if (!response.ok) {
    const detail = json?.issue?.[0]?.details?.text ?? `${response.status}`
    throw new BookingError(`Medplum ${method} ${path.split("?")[0]} failed: ${detail}`, response.status)
  }
  return json
}

async function search(resourceType: string, query: string): Promise<FhirResource[]> {
  const bundle = await fhir<Bundle>("GET", `${resourceType}?${query}`)
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
export async function getSiteDirectory(fhirLocationId: string): Promise<SiteDirectory> {
  const empty: SiteDirectory = { fhirLocationId, practitioners: [], services: [] }
  if (!bookingEnabled) {
    return empty
  }
  const cached = directoryCache.get(fhirLocationId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  try {
    const [scheduleEntries, serviceResources] = await Promise.all([
      search("Schedule", `actor=Location/${fhirLocationId}&active=true&_count=100&_include=Schedule:actor`),
      search("HealthcareService", `location=Location/${fhirLocationId}&active=true&_count=100&_sort=name`),
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
        scheduleId: schedule.id,
        serviceIds,
      })
    }
    practitioners.sort((a, b) => a.name.localeCompare(b.name))

    const services: BookingService[] = serviceResources
      .filter((s) => s.id)
      .map((s) => ({
        id: s.id as string,
        name: (typeof s.name === "string" && s.name) || s.type?.[0]?.text || s.type?.[0]?.coding?.[0]?.display || "Service",
      }))

    const value = { fhirLocationId, practitioners, services }
    directoryCache.set(fhirLocationId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  } catch (error) {
    console.error(`Booking directory unavailable for Location/${fhirLocationId}:`, error)
    return empty
  }
}

export async function getBookingDirectory(fhirLocationIds: string[]): Promise<Record<string, SiteDirectory>> {
  const unique = Array.from(new Set(fhirLocationIds.filter(Boolean)))
  const directories = await Promise.all(unique.map((id) => getSiteDirectory(id)))
  return Object.fromEntries(directories.map((d) => [d.fhirLocationId, d]))
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
  const slots = await findSlots(req.scheduleId, req.serviceId, new Date(wanted.getTime() - 60_000))
  const slot = slots.find((s) => s.start && new Date(s.start).getTime() === wanted.getTime())
  if (!slot) {
    throw new BookingError("That time is no longer available", 409)
  }

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

  // Record where it came from and what the patient told us.
  const notes = req.notes?.trim().slice(0, 1000)
  await fhir("PUT", `Appointment/${appointment.id}`, {
    ...appointment,
    ...(notes ? { comment: notes } : {}),
    meta: { ...((appointment.meta as object) ?? {}), tag: [{ system: APPOINTMENT_SOURCE_SYSTEM, code: "website" }] },
  }).catch((error) => console.error("Could not annotate website booking:", error))

  return { appointmentId: appointment.id, start: appointment.start as string, end: appointment.end as string }
}
