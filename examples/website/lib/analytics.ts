import posthog from "posthog-js"

/**
 * Every product event the website sends, in one place.
 *
 * Event names live here rather than as string literals at the call sites so a
 * rename cannot silently split a funnel in two, and so the components can be
 * tested by mocking this module instead of standing up posthog-js.
 */

export type PaymentMethod = "card" | "mobile_money"

/**
 * `instrumentation-client.ts` skips `posthog.init()` in production when either
 * variable is missing. Capturing against an uninitialised client only produces
 * console noise, so check the same condition here and stay quiet instead.
 */
const enabled = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST
)

function capture(event: string, properties?: Record<string, unknown>): void {
  if (!enabled) {
    return
  }
  posthog.capture(event, properties)
}

export function trackBookingDialogOpened(): void {
  capture("booking_dialog_opened")
}

export function trackBookingSlotSelected(): void {
  capture("booking_slot_selected")
}

export function trackBookingCreated(requiresPayment: boolean | undefined): void {
  capture("booking_created", { requires_payment: requiresPayment })
}

export function trackPaymentStarted(method: PaymentMethod): void {
  capture("booking_payment_started", { payment_method: method })
}

export function trackPaymentCompleted(method: PaymentMethod): void {
  capture("booking_payment_completed", { payment_method: method })
}

/**
 * Card checkout can be abandoned at the payment provider, which returns the
 * patient to /booking/complete?cancelled=. Without this the funnel cannot tell
 * a deliberate abandon apart from a payment still waiting on its webhook.
 */
export function trackPaymentCancelled(method: PaymentMethod): void {
  capture("booking_payment_cancelled", { payment_method: method })
}
