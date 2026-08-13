// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString } from '@medplum/core';
import type { Appointment } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Calendar } from '../../../components/Calendar';
import type { Range } from '../../../types/scheduling';
import { showErrorNotification } from '../../../utils/notifications';
import { DashboardPanel } from './DashboardPanel';

/**
 * Patient reference from an appointment's participants, if any.
 * @param appointment - The appointment to read participants from.
 * @returns The `Patient/<id>` reference, or undefined.
 */
function patientRefOf(appointment: Appointment): string | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
}

/**
 * Appointment calendar for the dashboard. Reuses the shared {@link Calendar}
 * component and loads appointments across all practitioners for the visible
 * range. Clicking an appointment opens it — the encounter chart if a visit has
 * started, otherwise the patient chart (or the appointment resource) — mirroring
 * the Schedule page. Empty slots are not bookable here (that stays on Schedule).
 *
 * @returns The calendar panel.
 */
export interface DashboardCalendarProps {
  /** Bump to refetch the visible range (live Appointment events). */
  refreshKey?: number;
}

export function DashboardCalendar(props: DashboardCalendarProps = {}): JSX.Element {
  const { refreshKey = 0 } = props;
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range | undefined>(undefined);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    if (!range) {
      return () => {};
    }
    let active = true;
    medplum
      .searchResources('Appointment', [
        ['_count', '1000'],
        ['date', `ge${range.start.toISOString()}`],
        ['date', `le${range.end.toISOString()}`],
      ])
      .then((result) => active && setAppointments(result))
      .catch(() => active && setAppointments([]));
    return () => {
      active = false;
    };
  }, [medplum, range, refreshKey]);

  const handleSelectAppointment = useCallback(
    async (appointment: Appointment): Promise<void> => {
      const reference = getReferenceString(appointment);
      if (!reference) {
        return;
      }
      try {
        const encounter = await medplum.searchOne('Encounter', [['appointment', reference]]);
        if (encounter?.subject?.reference) {
          await navigate(`/${encounter.subject.reference}/Encounter/${encounter.id}`);
          return;
        }
        const patientRef = patientRefOf(appointment);
        await navigate(patientRef ? `/${patientRef}` : `/Appointment/${appointment.id}`);
      } catch (error) {
        showErrorNotification(error);
      }
    },
    [medplum, navigate]
  );

  return (
    <DashboardPanel title="Appointment Calendar" subtitle="Plan your week at a glance" bodyHeight={460}>
      <Calendar
        style={{ height: '100%' }}
        slots={[]}
        appointments={appointments}
        onRangeChange={setRange}
        onSelectAppointment={handleSelectAppointment}
      />
    </DashboardPanel>
  );
}
