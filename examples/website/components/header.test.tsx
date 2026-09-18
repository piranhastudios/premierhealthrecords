import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { trackBookingDialogOpened } from "@/lib/analytics"

import { Header } from "./header"

vi.mock("@/lib/analytics", () => ({ trackBookingDialogOpened: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }))
vi.mock("@/components/sanity-image", () => ({ SanityImage: () => null }))
vi.mock("@/components/booking/booking-dialog", () => ({
  BookingDialog: () => <div data-testid="booking-dialog" />,
}))

const opened = vi.mocked(trackBookingDialogOpened)

describe("Header booking analytics", () => {
  beforeEach(() => {
    opened.mockClear()
  })

  it("reports the booking dialog opening, and only the opening", async () => {
    const user = userEvent.setup()
    render(<Header />)

    const [trigger] = screen.getAllByRole("button", { name: /bookAppointment/ })
    await user.click(trigger)

    expect(await screen.findByTestId("booking-dialog")).toBeInTheDocument()
    expect(opened).toHaveBeenCalledOnce()

    // Closing runs the same onOpenChange handler; it must not count as a second
    // person starting a booking.
    await user.keyboard("{Escape}")
    expect(opened).toHaveBeenCalledOnce()
  })

  it("reports nothing before anyone opens the dialog", () => {
    render(<Header />)
    expect(opened).not.toHaveBeenCalled()
  })
})
