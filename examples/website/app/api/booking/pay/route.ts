import { NextResponse } from "next/server"

import { BookingError, bookingEnabled, startPayment } from "@/lib/medplum"
import { callerKey, rateLimit } from "@/lib/rate-limit"

const ID_RE = /^[A-Za-z0-9\-.]{1,64}$/
const PHONE_RE = /^\+?[0-9 ()\-.]{8,20}$/
/** The mobile-money providers pawaPay serves in Cameroon. */
const CORRESPONDENTS = new Set(["MTN_MOMO_CMR", "ORANGE_CMR"])

type Body = {
  invoiceId?: string
  method?: "card" | "momo"
  phone?: string
  correspondent?: string
}

/**
 * Start payment for a booking fee. Card returns a Stripe Checkout link; mobile money
 * pushes a prompt to the payer's phone, which the client then polls for.
 */
export async function POST(request: Request) {
  if (!bookingEnabled) {
    return NextResponse.json({ error: "Online booking is not configured" }, { status: 503 })
  }
  // A mobile-money request rings a real phone, so keep the budget tight.
  const limit = rateLimit(callerKey(request, "pay"), 8, 300)
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { invoiceId, method } = body
  if (!invoiceId || !ID_RE.test(invoiceId) || (method !== "card" && method !== "momo")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (method === "momo") {
    if (!body.phone || !PHONE_RE.test(body.phone) || !body.correspondent || !CORRESPONDENTS.has(body.correspondent)) {
      return NextResponse.json({ error: "Check the phone number and provider" }, { status: 400 })
    }
  }

  try {
    const origin = new URL(request.url).origin
    const result = await startPayment({
      invoiceId,
      method,
      phone: body.phone,
      correspondent: body.correspondent,
      successUrl: `${origin}/booking/complete?invoice=${encodeURIComponent(invoiceId)}`,
      cancelUrl: `${origin}/booking/complete?invoice=${encodeURIComponent(invoiceId)}&cancelled=1`,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Payment could not be started:", error)
    const status = error instanceof BookingError && error.status >= 400 && error.status < 500 ? 400 : 502
    return NextResponse.json({ error: "Payment could not be started" }, { status })
  }
}
