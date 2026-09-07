import { NextResponse } from "next/server"

import { bookingEnabled, getPaymentStatus } from "@/lib/medplum"
import { callerKey, rateLimit } from "@/lib/rate-limit"

const ID_RE = /^[A-Za-z0-9\-.]{1,64}$/

/**
 * Whether a booking fee has been paid yet. The client polls this while the patient
 * approves the prompt on their phone, and the Stripe return page calls it once.
 * Confirming the held appointment happens here, when payment is seen to have landed.
 */
export async function GET(request: Request) {
  if (!bookingEnabled) {
    return NextResponse.json({ error: "Online booking is not configured" }, { status: 503 })
  }
  const limit = rateLimit(callerKey(request, "status"), 120, 300)
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  }
  const invoice = new URL(request.url).searchParams.get("invoice") ?? ""
  if (!ID_RE.test(invoice)) {
    return NextResponse.json({ error: "Invalid invoice" }, { status: 400 })
  }
  try {
    const status = await getPaymentStatus(invoice)
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Payment status lookup failed:", error)
    return NextResponse.json({ error: "Could not check the payment" }, { status: 502 })
  }
}
