/**
 * Server-only Medplum client for the booking flow.
 *
 * The website never writes to Medplum. It reads, with a read-only
 * client_credentials ClientApplication (scripts/seed-website-client.mjs), which
 * doctors and services each site offers so the booking dialog can send the
 * visitor to the right Cal.diy booking page. The Cal.diy link of a (doctor × site)
 * diary is stored on the FHIR Schedule as the identifier
 * https://premierhealth.cm/fhir/sid/caldiy-cal-link.
 *
 * Env: MEDPLUM_BASE_URL (ends with /), MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET.
 * Without them the dialog falls back to "call us" — the site still builds.
 */

const BASE_URL = process.env.MEDPLUM_BASE_URL?.replace(/\/?$/, "/")
const CLIENT_ID = process.env.MEDPLUM_CLIENT_ID
const CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET

const CAL_LINK_SYSTEM = "https://premierhealth.cm/fhir/sid/caldiy-cal-link"
const SERVICE_TYPE_REFERENCE_URL = "https://medplum.com/fhir/service-type-reference"
const CACHE_TTL_MS = 5 * 60 * 1000

export const bookingDirectoryEnabled = Boolean(BASE_URL && CLIENT_ID && CLIENT_SECRET)

export type BookingPractitioner = {
  id: string
  name: string
  /** `<username>/<event-slug>` on Cal.diy, or null when the diary is not online-bookable. */
  calLink: string | null
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

type FhirResource = {
  resourceType: string
  id?: string
  name?: unknown
  active?: boolean
  identifier?: { system?: string; value?: string }[]
  actor?: { reference?: string; display?: string }[]
  serviceType?: { extension?: { url?: string; valueReference?: { reference?: string } }[] }[]
  type?: { text?: string; coding?: { display?: string }[] }[]
}

type Bundle = { entry?: { resource?: FhirResource }[] }

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

async function search(resourceType: string, query: string): Promise<FhirResource[]> {
  const token = await getToken()
  const response = await fetch(`${BASE_URL}fhir/R4/${resourceType}?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/fhir+json" },
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`Medplum search ${resourceType} failed: ${response.status}`)
  }
  const bundle = (await response.json()) as Bundle
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

/**
 * Doctors and services bookable at one site, joined from the FHIR Schedules
 * (practitioner × site) and HealthcareServices of that Location.
 */
export async function getSiteDirectory(fhirLocationId: string): Promise<SiteDirectory> {
  const empty: SiteDirectory = { fhirLocationId, practitioners: [], services: [] }
  if (!bookingDirectoryEnabled) {
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
      if (schedule.resourceType !== "Schedule") {
        continue
      }
      const practitionerRef = schedule.actor?.find((a) => a.reference?.startsWith("Practitioner/"))
      const practitionerId = practitionerRef?.reference?.split("/")[1]
      if (!practitionerId) {
        continue
      }
      const practitioner = practitionersById.get(practitionerId)
      practitioners.push({
        id: practitionerId,
        name: (practitioner && humanName(practitioner)) || practitionerRef?.display || "Doctor",
        calLink: schedule.identifier?.find((i) => i.system === CAL_LINK_SYSTEM)?.value ?? null,
        serviceIds: serviceIdsOf(schedule),
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
