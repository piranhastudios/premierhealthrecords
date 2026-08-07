// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import type {
  Appointment,
  DiagnosticReport,
  ExtractResource,
  Observation,
  ResourceType,
  Task,
} from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useMemo, useState } from 'react';

/** Result of one of the overview searches. */
export interface OverviewSearchResult<T> {
  /** The resources, or undefined while loading / after a failure. */
  data: T[] | undefined;
  loading: boolean;
}

/**
 * Runs a FHIR search and keeps the result in state, ignoring responses from
 * superseded requests. Failures resolve to an empty list so a single forbidden
 * search degrades to an empty panel rather than breaking the page.
 *
 * @param resourceType - The resource type to search.
 * @param params - Search parameters as `[name, value]` tuples, or undefined to skip.
 * @returns The resources and a loading flag.
 */
function useOverviewSearch<K extends ResourceType>(
  resourceType: K,
  params: string[][] | undefined
): OverviewSearchResult<WithId<ExtractResource<K>>> {
  const medplum = useMedplum();
  const [data, setData] = useState<WithId<ExtractResource<K>>[] | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(!!params);

  // Params are rebuilt on every render, so key the effect on their contents.
  const key = params ? JSON.stringify(params) : undefined;

  useEffect(() => {
    if (!key) {
      // Nothing to search yet (the patient is still loading); state is already idle.
      return () => {};
    }
    let active = true;
    setLoading(true);
    medplum
      .searchResources(resourceType, JSON.parse(key) as string[][], { cache: 'no-cache' })
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setData([]);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, resourceType, key]);

  return { data, loading };
}

/** How many vital-sign observations to pull for the trend chart. */
const VITALS_PAGE_SIZE = 200;

/**
 * Loads the patient's recent vital-sign observations, newest first.
 *
 * @param patientId - The patient id, or undefined while the patient loads.
 * @returns The observations and a loading flag.
 */
export function useVitalsHistory(patientId: string | undefined): OverviewSearchResult<WithId<Observation>> {
  const params = useMemo(
    () =>
      patientId
        ? [
            ['patient', patientId],
            ['category', 'vital-signs'],
            ['_count', String(VITALS_PAGE_SIZE)],
            ['_sort', '-date'],
          ]
        : undefined,
    [patientId]
  );
  return useOverviewSearch('Observation', params);
}

/** Statuses that mean an appointment is no longer expected to happen. */
const INACTIVE_APPOINTMENT_STATUSES = new Set(['cancelled', 'noshow', 'entered-in-error']);

/** The patient's appointments, split around now. */
export interface PatientAppointments {
  /** Future appointments that are still expected, soonest first. */
  upcoming: WithId<Appointment>[] | undefined;
  /** Past appointments, most recent first. */
  past: WithId<Appointment>[] | undefined;
  loading: boolean;
}

/**
 * Loads the patient's next few appointments and their most recent past ones.
 *
 * @param patientId - The patient id, or undefined while the patient loads.
 * @returns Upcoming and past appointments with a loading flag.
 */
export function usePatientAppointments(patientId: string | undefined): PatientAppointments {
  // Captured once so the two searches share a boundary and the memoized params
  // stay stable across renders.
  const [now] = useState(() => new Date().toISOString());

  const upcomingParams = useMemo(
    () =>
      patientId
        ? [
            ['patient', patientId],
            ['date', `ge${now}`],
            ['_count', '10'],
            ['_sort', 'date'],
          ]
        : undefined,
    [patientId, now]
  );

  const pastParams = useMemo(
    () =>
      patientId
        ? [
            ['patient', patientId],
            ['date', `lt${now}`],
            ['_count', '5'],
            ['_sort', '-date'],
          ]
        : undefined,
    [patientId, now]
  );

  const upcoming = useOverviewSearch('Appointment', upcomingParams);
  const past = useOverviewSearch('Appointment', pastParams);

  return useMemo(
    () => ({
      upcoming: upcoming.data?.filter((appt) => !INACTIVE_APPOINTMENT_STATUSES.has(appt.status)),
      past: past.data,
      loading: upcoming.loading || past.loading,
    }),
    [upcoming.data, upcoming.loading, past.data, past.loading]
  );
}

/**
 * Loads the patient's most recent diagnostic reports.
 *
 * @param patientId - The patient id, or undefined while the patient loads.
 * @returns The reports and a loading flag.
 */
export function useRecentReports(patientId: string | undefined): OverviewSearchResult<WithId<DiagnosticReport>> {
  const params = useMemo(
    () =>
      patientId
        ? [
            ['patient', patientId],
            ['_count', '5'],
            ['_sort', '-date'],
          ]
        : undefined,
    [patientId]
  );
  return useOverviewSearch('DiagnosticReport', params);
}

/** Task statuses that no longer need attention. */
const CLOSED_TASK_STATUSES = new Set(['completed', 'cancelled', 'entered-in-error', 'rejected', 'failed']);

/** How many open tasks to show on the overview. */
const OPEN_TASK_LIMIT = 5;

/**
 * Loads the patient's open tasks. Filtering happens client-side so the panel
 * doesn't depend on `:not` modifier support.
 *
 * @param patientId - The patient id, or undefined while the patient loads.
 * @returns The open tasks and a loading flag.
 */
export function useOpenTasks(patientId: string | undefined): OverviewSearchResult<WithId<Task>> {
  const params = useMemo(
    () =>
      patientId
        ? [
            ['patient', patientId],
            ['_count', '30'],
            ['_sort', '-_lastUpdated'],
          ]
        : undefined,
    [patientId]
  );
  const { data, loading } = useOverviewSearch('Task', params);

  return useMemo(
    () => ({
      data: data?.filter((task) => !CLOSED_TASK_STATUSES.has(task.status)).slice(0, OPEN_TASK_LIMIT),
      loading,
    }),
    [data, loading]
  );
}
