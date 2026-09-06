"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildWeeklySchedule,
  getAvailableSlots,
  parseDateInput,
  slotLabel,
  type OpeningHoursEntry,
} from "@/lib/opening-hours"

export type AppointmentServiceOption = {
  _id: string
  title?: string | null
  slug?: string | null
}

type Props = {
  openingHours?: (OpeningHoursEntry | null)[] | null
  services?: AppointmentServiceOption[] | null
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`
}

export function AppointmentForm({ openingHours, services }: Props) {
  const t = useTranslations("appointment")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")

  const schedule = useMemo(() => buildWeeklySchedule(openingHours), [openingHours])
  const today = useMemo(() => toDateInputValue(new Date()), [])

  const selectedDate = date ? parseDateInput(date) : null
  const slots = useMemo(
    () => (selectedDate ? getAvailableSlots(selectedDate, schedule) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, schedule],
  )

  const isClosed = Boolean(selectedDate) && schedule[selectedDate!.getDay()] === null
  const isFullyBooked = Boolean(selectedDate) && !isClosed && slots.length === 0

  function handleDateChange(value: string) {
    setDate(value)
    setTime("") // a slot from the previous day should not carry over
  }

  return (
    <form className="space-y-4 pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t("firstName")}</Label>
          <Input id="firstName" placeholder="John" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">{t("lastName")}</Label>
          <Input id="lastName" placeholder="Doe" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">{t("phone")}</Label>
        <Input id="phone" type="tel" placeholder="+237 6 XX XX XX XX" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="appointmentEmail">{t("email")}</Label>
        <Input id="appointmentEmail" type="email" placeholder="john@example.com" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="service">{t("service")}</Label>
        <select
          id="service"
          name="service"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{t("selectService")}</option>
          {(services ?? []).map((service) => (
            <option key={service._id} value={service.slug ?? service._id}>
              {service.title}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="date">{t("date")}</Label>
        <Input
          id="date"
          name="date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => handleDateChange(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>{t("times")}</Label>

        {!date && (
          <p className="text-sm text-muted-foreground">{t("chooseDate")}</p>
        )}

        {isClosed && (
          <p className="text-sm text-muted-foreground">
            {t("closed")}
          </p>
        )}

        {isFullyBooked && (
          <p className="text-sm text-muted-foreground">
            {t("full")}
          </p>
        )}

        {slots.length > 0 && (
          <div
            role="radiogroup"
            aria-label={t("timesAria")}
            className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4"
          >
            {slots.map((slot) => {
              const isSelected = slot === time
              return (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setTime(slot)}
                  className={`rounded-md border px-2 py-2 text-sm transition-colors ${
                    isSelected
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-input bg-background text-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {slotLabel(slot)}
                </button>
              )
            })}
          </div>
        )}

        {/* Carries the chosen slot when the form is wired to a backend. */}
        <input type="hidden" name="time" value={time} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">{t("notes")}</Label>
        <textarea
          id="message"
          name="message"
          rows={3}
          placeholder={t("notesPlaceholder")}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <Button
        type="submit"
        disabled={!date || !time}
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {time ? t("request", { time: slotLabel(time) }) : t("selectDateTime")}
      </Button>
    </form>
  )
}
