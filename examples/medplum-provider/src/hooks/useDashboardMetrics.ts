// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Appointment, ResourceType } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Start of the local day, as an ISO string (inclusive lower bound).
 * @returns The ISO timestamp for 00:00:00 today.
 */
export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * End of the local day, as an ISO string (inclusive upper bound).
 * @returns The ISO timestamp for 23:59:59.999 today.
 */
export function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/**
 * Start of the local day `daysAgo` days in the past, as an ISO string.
 * @param daysAgo - Number of days to subtract from today.
 * @returns The ISO timestamp for 00:00:00 on that day.
 */
export function startOfDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface CountResult {
  count: number | undefined;
  loading: boolean;
}

/**
 * Fetches the total count of resources matching a FHIR search criteria using
 * `_summary=count` (server returns only `Bundle.total`, no entries — the cheapest
 * way to count). Mirrors the notificationCount pattern used in App.tsx.
 *
 * @param resourceType - The FHIR resource type to count.
 * @param criteria - Search criteria (without `_summary`), e.g. `status=in-progress`.
 * @param enabled - When false, the query is skipped (for role-gated tiles).
 * @param refreshKey - Bump to refetch (e.g. after a dashboard action mutates data).
 * @returns The count and a loading flag.
 */
export function useCount(resourceType: ResourceType, criteria = '', enabled = true, refreshKey = 0): CountResult {
  const medplum = useMedplum();
  const [count, setCount] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(enabled);

  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    let active = true;
    setLoading(true);
    const query = criteria ? `${criteria}&_summary=count` : '_summary=count';
    medplum
      .search(resourceType, query, { cache: 'no-cache' })
      .then((bundle) => {
        if (active) {
          setCount(bundle.total ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        // Counts are best-effort; a forbidden/failed count shows as "—" rather
        // than breaking the dashboard.
        if (active) {
          setCount(undefined);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, resourceType, criteria, enabled, refreshKey]);

  return { count, loading };
}

export interface TodayAppointmentsResult {
  appointments: Appointment[] | undefined;
  loading: boolean;
  /** Refetches today's appointments (after a check-in or status change). */
  refresh: () => void;
}

/**
 * Loads today's appointments (across all practitioners) ordered by start time.
 * Shared by the "today by status" donut and the station queue so we only hit
 * the server once. `refresh()` refetches after a queue action mutates a status.
 *
 * @param enabled - When false, the query is skipped.
 * @returns Today's appointments, a loading flag, and a refresh callback.
 */
export function useTodayAppointments(enabled = true): TodayAppointmentsResult {
  const medplum = useMedplum();
  const [appointments, setAppointments] = useState<Appointment[] | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    let active = true;
    setLoading(true);
    medplum
      .searchResources('Appointment', [
        ['_count', '100'],
        ['date', `ge${startOfToday()}`],
        ['date', `le${endOfToday()}`],
        ['_sort', 'date'],
      ])
      .then((result) => {
        if (active) {
          setAppointments(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setAppointments([]);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, enabled, tick]);

  return { appointments, loading, refresh };
}
