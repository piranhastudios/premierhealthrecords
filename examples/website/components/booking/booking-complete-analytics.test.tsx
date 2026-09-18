import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { trackPaymentCancelled, trackPaymentCompleted } from "@/lib/analytics"

import { BookingCompleteAnalytics } from "./booking-complete-analytics"

vi.mock("@/lib/analytics", () => ({
  trackPaymentCompleted: vi.fn(),
  trackPaymentCancelled: vi.fn(),
}))

const completed = vi.mocked(trackPaymentCompleted)
const cancelled = vi.mocked(trackPaymentCancelled)

describe("BookingCompleteAnalytics", () => {
  beforeEach(() => {
    completed.mockClear()
    cancelled.mockClear()
  })

  it("reports a paid card checkout as completed", () => {
    render(<BookingCompleteAnalytics paid cancelled={false} />)
    expect(completed).toHaveBeenCalledExactlyOnceWith("card")
    expect(cancelled).not.toHaveBeenCalled()
  })

  it("reports an abandoned checkout as cancelled", () => {
    render(<BookingCompleteAnalytics paid={false} cancelled />)
    expect(cancelled).toHaveBeenCalledExactlyOnceWith("card")
    expect(completed).not.toHaveBeenCalled()
  })

  // The page waits only 1500ms for the payment webhook. A payment still in
  // flight is not a conversion and must not be counted as one.
  it("stays silent while the payment is unconfirmed", () => {
    render(<BookingCompleteAnalytics paid={false} cancelled={false} />)
    expect(completed).not.toHaveBeenCalled()
    expect(cancelled).not.toHaveBeenCalled()
  })

  it("cancellation wins over a paid flag, and never double counts", () => {
    const { rerender } = render(<BookingCompleteAnalytics paid cancelled />)
    rerender(<BookingCompleteAnalytics paid cancelled />)
    expect(cancelled).toHaveBeenCalledExactlyOnceWith("card")
    expect(completed).not.toHaveBeenCalled()
  })

  it("reports a conversion once even if re-rendered", () => {
    const { rerender } = render(<BookingCompleteAnalytics paid cancelled={false} />)
    rerender(<BookingCompleteAnalytics paid cancelled={false} />)
    expect(completed).toHaveBeenCalledExactlyOnceWith("card")
  })
})
