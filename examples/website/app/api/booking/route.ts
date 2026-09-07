import { NextResponse } from "next/server"

import { BookingError, bookAppointment, bookingEnabled, type BookingRequest } from "@/lib/medplum"

const ID_RE = /^[A-Za-z0-9\-.]{1,64}$/
const NAME_RE = /^[\p{L}\p{M}'’ .-]{1,80}$/u
const PHONE_RE = /^\+?[0-9 ()\-.]{8,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = Partial<BookingRequest> & { website?: string }

/** Book a slot for a visitor. Creates (or matches by phone/email) the Patient. */
export async function POST(request: Request) {
  if (!bookingEnabled) {
    return NextResponse.json({ error: "Online booking is not configured" }, { status: 503 })
  }
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  // Honeypot: real visitors never fill this field.
  if (body.website) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }
  const firstName = body.firstName?.trim() ?? ""
  const lastName = body.lastName?.trim() ?? ""
  const phone = body.phone?.trim() ?? ""
  const email = body.email?.trim() || undefined
  if (
    !ID_RE.test(body.scheduleId ?? "") ||
    !ID_RE.test(body.serviceId ?? "") ||
    !body.start ||
    !NAME_RE.test(firstName) ||
    !NAME_RE.test(lastName) ||
    !PHONE_RE.test(phone) ||
    (email && !EMAIL_RE.test(email))
  ) {
    return NextResponse.json({ error: "Please check your details" }, { status: 400 })
  }
  try {
    const result = await bookAppointment({
      scheduleId: body.scheduleId as string,
      serviceId: body.serviceId as string,
      start: body.start,
      firstName,
      lastName,
      phone,
      email,
      notes: body.notes,
      locale: body.locale === "fr" ? "fr" : "en",
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Booking failed:", error)
    if (error instanceof BookingError && error.status === 409) {
      return NextResponse.json({ error: "taken" }, { status: 409 })
    }
    return NextResponse.json({ error: "Booking failed" }, { status: 502 })
  }
}
