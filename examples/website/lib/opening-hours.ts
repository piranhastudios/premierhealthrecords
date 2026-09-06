export type OpeningHoursEntry = {
  _key?: string
  days?: string | null
  hours?: string | null
}

/** Minutes from midnight that the clinic opens and closes on a given weekday. */
export type DayWindow = { open: number; close: number }

/** Index 0 = Sunday, matching `Date.prototype.getDay()`. `null` means closed. */
export type WeeklySchedule = (DayWindow | null)[]

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

function dayIndex(token: string): number | null {
  const key = token.trim().toLowerCase().replace(/\.$/, "")
  return key in DAY_INDEX ? DAY_INDEX[key] : null
}

/** Expands "Mon - Fri", "Sat", or "Mon, Wed" into weekday indices. */
export function parseDays(input: string | null | undefined): number[] {
  if (!input) return []

  const days = new Set<number>()

  for (const part of input.split(",")) {
    const range = part.split(/[-–—]/)

    if (range.length === 2) {
      const start = dayIndex(range[0])
      const end = dayIndex(range[1])
      if (start === null || end === null) continue
      // Walk forward so ranges that wrap the week (e.g. Sat - Mon) still work.
      for (let i = 0; i < 7; i++) {
        const day = (start + i) % 7
        days.add(day)
        if (day === end) break
      }
    } else {
      const single = dayIndex(part)
      if (single !== null) days.add(single)
    }
  }

  return [...days].sort((a, b) => a - b)
}

/** Parses "9 AM", "9:30 AM", "18:00" into minutes from midnight. */
export function parseTime(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null

  let hours = Number(match[1])
  const minutes = match[2] ? Number(match[2]) : 0
  const meridiem = match[3]

  if (minutes > 59) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    if (meridiem === "pm" && hours !== 12) hours += 12
    if (meridiem === "am" && hours === 12) hours = 0
  } else if (hours > 23) {
    return null
  }

  return hours * 60 + minutes
}

/** Parses "9 AM - 6 PM" into a window, or null for "Closed". */
export function parseHours(input: string | null | undefined): DayWindow | null {
  if (!input) return null
  if (/closed/i.test(input)) return null

  const parts = input.split(/[-–—]/)
  if (parts.length !== 2) return null

  const open = parseTime(parts[0])
  const close = parseTime(parts[1])
  if (open === null || close === null || close <= open) return null

  return { open, close }
}

/** Turns the CMS opening-hours list into a lookup by weekday. */
export function buildWeeklySchedule(entries: (OpeningHoursEntry | null)[] | null | undefined): WeeklySchedule {
  const schedule: WeeklySchedule = [null, null, null, null, null, null, null]

  for (const entry of entries ?? []) {
    if (!entry) continue
    const window = parseHours(entry.hours)
    if (!window) continue
    for (const day of parseDays(entry.days)) {
      schedule[day] = window
    }
  }

  return schedule
}

function toMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

/** Parses "YYYY-MM-DD" in local time (avoids the UTC shift of `new Date(str)`). */
export function parseDateInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatSlot(minutes: number): string {
  const hours24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  const meridiem = hours24 < 12 ? "AM" : "PM"
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${String(mins).padStart(2, "0")} ${meridiem}`
}

export type SlotOptions = {
  /** Length of each appointment slot, in minutes. */
  intervalMinutes?: number
  /** How long an appointment needs before closing time. */
  durationMinutes?: number
  /** Injected for testing; defaults to the current time. */
  now?: Date
}

/**
 * Bookable start times for a date, as "HH:MM" values. Returns an empty list
 * when the clinic is closed or every remaining slot today has passed.
 */
export function getAvailableSlots(
  date: Date,
  schedule: WeeklySchedule,
  { intervalMinutes = 30, durationMinutes = 30, now = new Date() }: SlotOptions = {},
): string[] {
  const window = schedule[date.getDay()]
  if (!window) return []

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  // Don't offer times that have already passed today.
  const earliest = isToday ? Math.max(window.open, toMinutes(now)) : window.open

  const slots: string[] = []
  const firstSlot = Math.ceil(earliest / intervalMinutes) * intervalMinutes

  for (let t = firstSlot; t + durationMinutes <= window.close; t += intervalMinutes) {
    slots.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`)
  }

  return slots
}

export function slotLabel(slot: string): string {
  const [h, m] = slot.split(":").map(Number)
  return formatSlot(h * 60 + m)
}
