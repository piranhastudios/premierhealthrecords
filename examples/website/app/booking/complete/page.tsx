import { getTranslations } from "next-intl/server"
import Link from "next/link"

import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { bookingEnabled, getPaymentStatus } from "@/lib/medplum"

/**
 * Where the card checkout sends the patient back to.
 *
 * Reading the payment status here is what confirms the held appointment, so the
 * booking is completed even though the patient left the site to pay. Stripe's
 * webhook is what actually marks the invoice paid; this page only observes it.
 */
export default async function BookingCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ invoice?: string; cancelled?: string }>
}) {
  const { invoice, cancelled } = await searchParams
  const t = await getTranslations("booking")

  let paid = false
  let checked = false
  if (bookingEnabled && invoice && !cancelled) {
    try {
      // The webhook and this redirect race, so give the webhook a moment to land.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const status = await getPaymentStatus(invoice)
      paid = status.paid
      checked = true
    } catch (error) {
      console.error("Could not confirm a booking after checkout:", error)
    }
  }

  const heading = cancelled ? t("payCancelled") : paid ? t("successTitle") : t("completeTitle")
  const body = cancelled ? t("payCancelled") : paid ? t("successBody") : checked ? t("payPending") : t("completeChecking")

  return (
    <>
      <SiteHeader variant="solid" />
      <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <h1 className="font-serif text-3xl">{heading}</h1>
        <p className="max-w-md text-muted-foreground">{body}</p>
        <Button asChild className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
          <Link href="/">{t("back")}</Link>
        </Button>
      </main>
    </>
  )
}
