import { NextResponse } from "next/server"

import { BookingError, bookingEnabled, findAvailability } from "@/lib/medplum"

const ID_RE = /^[A-Za-z0-9\-.]{1,64}$/

/** Free times for a (doctor × site) schedule and service over the booking window. */
export async function GET(request: Request) {
  if (!bookingEnabled) {
    return NextResponse.json({ error: "Online booking is not configured" }, { status: 503 })
  }
  const { searchParams } = new URL(request.url)
  const schedule = searchParams.get("schedule") ?? ""
  const service = searchParams.get("service") ?? ""
  if (!ID_RE.test(schedule) || !ID_RE.test(service)) {
    return NextResponse.json({ error: "Invalid schedule or service" }, { status: 400 })
  }
  try {
    const slots = await findAvailability(schedule, service)
    return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Availability lookup failed:", error)
    const status = error instanceof BookingError && error.status >= 400 && error.status < 500 ? 400 : 502
    return NextResponse.json({ error: "Could not load available times" }, { status })
  }
}
