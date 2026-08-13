// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Appointment } from '@medplum/fhirtypes';

/** Brand-aligned hex color for each Appointment.status. */
export const APPOINTMENT_STATUS_COLOR: Record<string, string> = {
  booked: '#f47b20', // brand orange
  arrived: '#fdb913', // gold
  'checked-in': '#fdb913',
  fulfilled: '#1f9d55', // success green
  cancelled: '#c8102e', // brand red
  noshow: '#9a8b82', // warm muted
  proposed: '#adb5bd',
  pending: '#adb5bd',
  waitlist: '#adb5bd',
  'entered-in-error': '#868e96',
};

const DEFAULT_COLOR = '#868e96';

/**
 * Returns the brand hex color for an appointment status.
 * @param status - The FHIR Appointment.status value.
 * @returns A hex color string.
 */
export function statusColor(status: string | undefined): string {
  return (status && APPOINTMENT_STATUS_COLOR[status]) || DEFAULT_COLOR;
}

/**
 * Title-cases a FHIR status token, e.g. `checked-in` -> `Checked In`.
 * @param status - The FHIR Appointment.status value.
 * @returns A human-friendly label.
 */
export function statusLabel(status: string | undefined): string {
  if (!status) {
    return 'Unknown';
  }
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface StatusDatum {
  status: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Groups appointments by status into chart-ready data, sorted by count desc.
 * @param appointments - The appointments to group.
 * @returns One entry per status with count, label, and color.
 */
export function groupByStatus(appointments: Appointment[]): StatusDatum[] {
  const counts = new Map<string, number>();
  for (const appt of appointments) {
    const status = appt.status ?? 'unknown';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, value]) => ({ status, value, label: statusLabel(status), color: statusColor(status) }))
    .sort((a, b) => b.value - a.value);
}
