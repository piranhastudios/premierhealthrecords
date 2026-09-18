"use client"

import { useEffect, useRef } from "react"

import { trackPaymentCancelled, trackPaymentCompleted } from "@/lib/analytics"

/**
 * Reports the outcome of a card payment.
 *
 * Card checkout takes the patient off the site, so the browser that started the
 * payment never sees it finish. The server component rendering this has already
 * asked Medplum whether the invoice is paid, so pass that answer on here and the
 * booking_payment_started -> booking_payment_completed funnel covers card as
 * well as mobile money.
 *
 * An unconfirmed payment sends nothing: the page waits only 1500ms for the
 * webhook, and a payment still in flight must not be counted as a conversion.
 */
export function BookingCompleteAnalytics({ paid, cancelled }: { paid: boolean; cancelled: boolean }) {
  // Effects run twice under React's development double-render, and this must
  // not double-count a conversion.
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current) {
      return
    }
    if (cancelled) {
      reported.current = true
      trackPaymentCancelled("card")
      return
    }
    if (paid) {
      reported.current = true
      trackPaymentCompleted("card")
    }
  }, [paid, cancelled])

  return null
}
