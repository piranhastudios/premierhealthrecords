import posthog from "posthog-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  trackBookingCreated,
  trackBookingDialogOpened,
  trackBookingSlotSelected,
  trackPaymentCancelled,
  trackPaymentCompleted,
  trackPaymentStarted,
} from "./analytics"

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }))

const capture = vi.mocked(posthog.capture)

/**
 * The event contract. PostHog queries and dashboards are built on these exact
 * names and property keys, so a rename here has to be a deliberate edit rather
 * than a refactor nobody noticed.
 */
describe("analytics events", () => {
  beforeEach(() => {
    capture.mockClear()
  })

  it("captures booking_dialog_opened", () => {
    trackBookingDialogOpened()
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_dialog_opened", undefined)
  })

  it("captures booking_slot_selected", () => {
    trackBookingSlotSelected()
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_slot_selected", undefined)
  })

  it("captures booking_created with requires_payment", () => {
    trackBookingCreated(true)
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_created", { requires_payment: true })
  })

  it("passes an unknown requires_payment through rather than guessing", () => {
    trackBookingCreated(undefined)
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_created", { requires_payment: undefined })
  })

  it.each(["card", "mobile_money"] as const)("captures booking_payment_started for %s", (method) => {
    trackPaymentStarted(method)
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_payment_started", { payment_method: method })
  })

  it.each(["card", "mobile_money"] as const)("captures booking_payment_completed for %s", (method) => {
    trackPaymentCompleted(method)
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_payment_completed", { payment_method: method })
  })

  it("captures booking_payment_cancelled", () => {
    trackPaymentCancelled("card")
    expect(capture).toHaveBeenCalledExactlyOnceWith("booking_payment_cancelled", { payment_method: "card" })
  })
})
