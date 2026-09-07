// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Box, Drawer, Group, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { WithId } from '@medplum/core';
import { EMPTY, getReferenceString, isReference } from '@medplum/core';
import type { Appointment, Location, Practitioner, Reference, Schedule, Slot } from '@medplum/fhirtypes';
import { ReferenceInput, useMedplum } from '@medplum/react';
import { IconSettings } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { SlotInfo } from 'react-big-calendar';
import { useNavigate, useParams } from 'react-router';
import { Calendar } from '../../components/Calendar';
import { AppointmentDetails } from '../../components/schedule/AppointmentDetails';
import { CreateVisit } from '../../components/schedule/CreateVisit';
import { SitePicker } from '../../components/SitePicker';
import { siteSearchParams, useSiteFilter } from '../../hooks/useSiteFilter';
import { canWriteResource } from '../../hooks/useUserRole';
import type { Range } from '../../types/scheduling';
import { getScheduleLocation } from '../../utils/encounter';
import { showErrorNotification } from '../../utils/notifications';
import { hasSchedulingParameters } from '../../utils/scheduling';
import { toCodeableReferenceLike } from '../../utils/servicetype';
import { mergeOverlappingSlots } from '../../utils/slots';
import { FindPane } from './FindPane';
import classes from './SchedulePage.module.css';

/**
 * Schedule page that displays the practitioner's schedule.
 * Allows the practitioner to create/update slots and create appointments.
 * @returns A React component that displays the schedule page.
 */
export function SchedulePage(): JSX.Element | null {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const medplum = useMedplum();

  // Without an id in the URL, the page is the clinic-wide view: every
  // appointment across all practitioners. Picking a practitioner in "Switch
  // schedule…" narrows to their diary (and enables slot/visit creation).
  const [createAppointmentOpened, createAppointmentHandlers] = useDisclosure(false);
  const [appointmentDetailsOpened, appointmentDetailsHandlers] = useDisclosure(false);
  const [schedule, setSchedule] = useState<WithId<Schedule> | undefined>();
  const [range, setRange] = useState<Range | undefined>(undefined);
  const [slots, setSlots] = useState<Slot[] | undefined>(undefined);
  const [appointments, setAppointments] = useState<Appointment[] | undefined>(undefined);

  const [appointmentSlot, setAppointmentSlot] = useState<Range>();
  const [appointmentDetails, setAppointmentDetails] = useState<Appointment | undefined>(undefined);

  // Current site (Location). Narrows the clinic-wide view and decides which
  // per-site Schedule a practitioner pick opens or creates.
  const { siteRef, sites, site: selectedSite } = useSiteFilter();
  const scheduleSite = getScheduleLocation(schedule);
  const scheduleSiteName = sites.find((candidate) => `Location/${candidate.id}` === scheduleSite?.reference)?.name;

  // Load the schedule directly from the URL param; no id = clinic-wide view.
  useEffect(() => {
    setSchedule(undefined);
    setSlots(undefined);
    if (!id) {
      return;
    }
    medplum.readResource('Schedule', id).then(setSchedule).catch(showErrorNotification);
  }, [id, medplum]);

  // Find slots visible in the current range
  useEffect(() => {
    if (!schedule || !range) {
      return () => {};
    }
    let active = true;

    medplum
      .searchResources('Slot', [
        ['_count', '1000'],
        ['schedule', getReferenceString(schedule)],
        ['start', `ge${range.start.toISOString()}`],
        ['start', `le${range.end.toISOString()}`],
        ['status', 'free,busy-unavailable'],
      ])
      .then((rawSlots) => active && setSlots(mergeOverlappingSlots(rawSlots)))
      .catch((error: unknown) => active && showErrorNotification(error));

    return () => {
      active = false;
    };
  }, [medplum, schedule, range]);

  // Find appointments visible in the current range: the selected practitioner's
  // when a schedule is loaded, or the whole clinic's when there is no id.
  useEffect(() => {
    // The practitioner is the primary actor; Location actors are the site.
    const actorRef = schedule?.actor?.find((actor) => !actor.reference?.startsWith('Location/'))?.reference;
    if (!range || (id && !actorRef)) {
      return () => {};
    }
    let active = true;

    medplum
      .searchResources('Appointment', [
        ['_count', '1000'],
        ...(actorRef ? [['actor', actorRef] as [string, string]] : []),
        // Clinic-wide view: honour the site filter. A loaded schedule already
        // implies its site.
        ...(schedule ? [] : siteSearchParams(siteRef)),
        ['date', `ge${range.start.toISOString()}`],
        ['date', `le${range.end.toISOString()}`],
      ])
      .then((appointments) => active && setAppointments(appointments))
      .catch((error: unknown) => active && showErrorNotification(error));

    return () => {
      active = false;
    };
  }, [medplum, id, schedule, range, siteRef]);

  const practitioner = schedule?.actor.find((actor) => isReference<Practitioner>(actor, 'Practitioner'));

  // When a date/time interval is selected, set the event object and open the
  // create appointment modal
  const handleSelectInterval = useCallback(
    (slot: SlotInfo) => {
      if (!practitioner) {
        showErrorNotification('Pick a practitioner in "Switch schedule…" to create a visit.');
        return;
      }

      createAppointmentHandlers.open();
      setAppointmentSlot(slot);
    },
    [createAppointmentHandlers, practitioner]
  );

  const handleSelectSlot = useCallback(
    (slot: Slot) => {
      if (!practitioner) {
        showErrorNotification('Pick a practitioner in "Switch schedule…" to create a visit.');
        return;
      }

      // When a "free" slot is selected, open the create appointment modal
      if (slot.status === 'free') {
        createAppointmentHandlers.open();
        setAppointmentSlot({ start: new Date(slot.start), end: new Date(slot.end) });
      }
    },
    [createAppointmentHandlers, practitioner]
  );

  const handleBookSuccess = useCallback(
    (results: { appointments: Appointment[]; slots: Slot[] }) => {
      setAppointments((state) => results.appointments.concat(state ?? EMPTY));
      setAppointmentDetails(results.appointments[0]);
      appointmentDetailsHandlers.open();
      setSlots((state) =>
        results.slots
          .filter(
            // We don't show "busy" slots, assuming that they are duplicative of
            // more descriptive Appointment resources.
            (slot) => slot.status !== 'busy'
          )
          .concat(state ?? EMPTY)
      );
    },
    [appointmentDetailsHandlers]
  );

  // When an appointment is selected, navigate to the detail page
  const handleSelectAppointment = useCallback(
    async (appointment: Appointment) => {
      const reference = getReferenceString(appointment);
      if (!reference) {
        showErrorNotification("Can't navigate to unsaved appointment");
        return;
      }

      try {
        const encounter = await medplum.searchOne('Encounter', [['appointment', reference]]);

        if (!encounter) {
          setAppointmentDetails(appointment);
          appointmentDetailsHandlers.open();
          return;
        }

        const patient = encounter.subject;
        if (patient?.reference) {
          await navigate(`/${patient.reference}/Encounter/${encounter.id}`);
        }
      } catch (error) {
        showErrorNotification(error);
      }
    },
    [medplum, navigate, appointmentDetailsHandlers]
  );

  const height = window.innerHeight - 60;

  const handleAppointmentUpdate = useCallback((updated: Appointment) => {
    setAppointments((state) => (state ?? []).map((existing) => (existing.id === updated.id ? updated : existing)));
    setAppointmentDetails((existing) => (existing?.id === updated.id ? updated : existing));
  }, []);

  const handleActorChange = useCallback(
    (ref: Reference | undefined) => {
      if (!ref?.reference) {
        // Cleared the picker: back to the clinic-wide view.
        navigate('/Calendar/Schedule')?.catch(console.error);
        return;
      }
      // The site a schedule belongs to: the selected one, or the clinic's only
      // site. With several sites and "All sites" selected we still open an
      // existing diary, but refuse to create one without knowing where.
      const targetSite = selectedSite ?? (sites.length === 1 ? sites[0] : undefined);
      const targetSiteRef = targetSite ? `Location/${targetSite.id}` : undefined;

      medplum
        .searchResources('Schedule', { actor: ref.reference, _count: '50' })
        .then(async (candidates) => {
          const withSite = (candidate: Schedule): string | undefined => getScheduleLocation(candidate)?.reference;
          const foundSchedule = targetSiteRef
            ? (candidates.find((candidate) => withSite(candidate) === targetSiteRef) ??
              candidates.find((candidate) => !withSite(candidate)))
            : candidates[0];
          if (foundSchedule?.id) {
            await navigate(`/Calendar/Schedule/${foundSchedule.id}`);
            return;
          }
          if (!canWriteResource(medplum.getAccessPolicy(), 'Schedule')) {
            showErrorNotification('This practitioner has no schedule yet — ask a clinician or admin to open it.');
            return;
          }
          if (!targetSite) {
            showErrorNotification('Pick a site first, then choose the practitioner to open their diary there.');
            return;
          }
          // First visit to this practitioner's diary at this site: open it with
          // every service the site offers (staff can trim these in Settings).
          const services = await medplum.searchResources('HealthcareService', {
            location: targetSiteRef as string,
            active: 'true',
            _count: '100',
          });
          const created = await medplum.createResource<Schedule>({
            resourceType: 'Schedule',
            actor: [
              ref as Reference<Practitioner>,
              { reference: targetSiteRef as string, display: targetSite.name } as Reference<Location>,
            ],
            active: true,
            serviceType: services.flatMap((service) => toCodeableReferenceLike(service)),
          });
          await navigate(`/Calendar/Schedule/${created.id}`);
        })
        .catch(showErrorNotification);
    },
    [medplum, navigate, selectedSite, sites]
  );

  return (
    <Box pos="relative" p="md" style={{ height, backgroundColor: 'var(--phc-surface-card)' }}>
      <div className={classes.wrapper}>
        <Group justify="space-between">
          <Group gap="sm" mb="sm" align="flex-start">
            <SitePicker w={240} />
            <Box w={320}>
              <ReferenceInput
                key={schedule?.id ?? 'all'}
                name="schedule-actor"
                targetTypes={['Practitioner']}
                placeholder={id ? 'Switch schedule...' : 'All appointments — pick a schedule...'}
                defaultValue={practitioner}
                onChange={handleActorChange}
              />
            </Box>
            {schedule && (scheduleSiteName ?? scheduleSite?.display) && (
              <Text size="sm" c="dimmed" pt={8}>
                {scheduleSiteName ?? scheduleSite?.display}
              </Text>
            )}
          </Group>
          {schedule && hasSchedulingParameters(schedule) && (
            <ActionIcon
              variant="subtle"
              aria-label="Schedule settings"
              onClick={() => navigate(`/Calendar/Schedule/${schedule.id}/settings`)}
            >
              <IconSettings />
            </ActionIcon>
          )}
        </Group>
        <div className={classes.container}>
          <div className={classes.calendar}>
            <Calendar
              style={{ height: '100%' }}
              onSelectInterval={handleSelectInterval}
              onSelectAppointment={handleSelectAppointment}
              onSelectSlot={handleSelectSlot}
              slots={slots ?? []}
              appointments={appointments ?? []}
              onRangeChange={setRange}
            />
          </div>

          {schedule && range && (
            <FindPane
              key={schedule.id}
              schedule={schedule}
              range={range}
              onSuccess={handleBookSuccess}
              className={classes.findPane}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {practitioner && (
        <Drawer
          opened={createAppointmentOpened}
          onClose={createAppointmentHandlers.close}
          title="New Calendar Event"
          position="right"
          h="100%"
        >
          <CreateVisit appointmentSlot={appointmentSlot} schedule={schedule} practitioner={practitioner} />
        </Drawer>
      )}
      <Drawer
        opened={appointmentDetailsOpened}
        onClose={appointmentDetailsHandlers.close}
        title={
          <Text size="xl" fw={700}>
            Appointment Details
          </Text>
        }
        position="right"
        h="100%"
      >
        {appointmentDetails && (
          <AppointmentDetails appointment={appointmentDetails} onUpdate={handleAppointmentUpdate} />
        )}
      </Drawer>
    </Box>
  );
}
