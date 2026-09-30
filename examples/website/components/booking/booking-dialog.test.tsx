import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import messages from "@/messages/en.json"

import { BookingDialog, type BookingSite } from "./booking-dialog"

vi.mock("@/lib/analytics", () => ({
  trackBookingCreated: vi.fn(),
  trackBookingSlotSelected: vi.fn(),
  trackPaymentCompleted: vi.fn(),
  trackPaymentStarted: vi.fn(),
}))

const douala: BookingSite = {
  id: "site-douala",
  name: "Premier Health Centre – Douala Grand Mall",
  address: "Boulevard de la République, Douala",
  fhirLocationId: "location-douala",
  practitioners: [
    { id: "gp-1", name: "Dr Afong", specialty: "General practice", scheduleId: "s1", serviceIds: ["consult"] },
    { id: "cardio-1", name: "Dr Mokube", specialty: "Cardiology", scheduleId: "s2", serviceIds: ["consult"] },
  ],
  services: [{ id: "consult", name: "Consultation", modes: ["in-person"] }],
}

function renderDialog(sites: BookingSite[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BookingDialog sites={sites} />
    </NextIntlClientProvider>
  )
}

describe("BookingDialog location step", () => {
  // Patients must always confirm where they are booking, even while the
  // clinic has a single centre.
  it("asks for the centre first even when there is only one", () => {
    renderDialog([douala])
    expect(screen.getByText(messages.booking.pickSite)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: new RegExp(douala.name) })).toBeInTheDocument()
    expect(screen.queryByText(messages.booking.pickSpecialty)).not.toBeInTheDocument()
  })

  it("moves on to what the patient needs once the centre is chosen, and can go back", async () => {
    const user = userEvent.setup()
    renderDialog([douala])

    await user.click(screen.getByRole("button", { name: new RegExp(douala.name) }))
    expect(screen.getByText(messages.booking.pickSpecialty)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: messages.booking.back }))
    expect(screen.getByText(messages.booking.pickSite)).toBeInTheDocument()
  })
})
