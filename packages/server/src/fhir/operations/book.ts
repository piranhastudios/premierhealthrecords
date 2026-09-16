// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import {
  badRequest,
  conflict,
  created,
  DEFAULT_MAX_SEARCH_COUNT,
  EMPTY,
  getReferenceString,
  isNotFound,
  OperationOutcomeError,
  Operator,
} from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type {
  Appointment,
  Bundle,
  CodeableConcept,
  HealthcareService,
  OperationDefinition,
  Patient,
  Reference,
  Slot,
} from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { addMinutes, areIntervalsOverlapping } from '../../util/date';
import { invariant } from '../../util/invariant';
import { extractReferencesFromCodeableReferenceLike } from '../../util/servicetype';
import { buildOutputParameters, parseInputParameters } from './utils/parameters';
import {
  applyExistingSlots,
  getPrimaryActor,
  getTimeZone,
  isLocationActor,
  resolveAvailability,
} from './utils/scheduling';
import { chooseSchedulingParameters } from './utils/scheduling-parameters';

const bookOperation = {
  resourceType: 'OperationDefinition',
  name: 'book',
  status: 'active',
  kind: 'operation',
  code: 'book',
  resource: ['Appointment'],
  system: false,
  type: true,
  instance: false,
  parameter: [
    { use: 'in', name: 'slot', type: 'Resource', min: 1, max: '*' },
    { use: 'in', name: 'patient-reference', type: 'Reference', min: 0, max: '1' },
    // How the visit is to be conducted — routine, follow-up, telehealth. Without
    // it every booking made through this operation lands with no type at all, so
    // nothing downstream can tell an in-person visit from a video one, and the
    // provider's Visits list has only the word "Appointment" to show.
    { use: 'in', name: 'appointment-type', type: 'CodeableConcept', min: 0, max: '1' },
    { use: 'out', name: 'return', type: 'Bundle', min: 0, max: '1' },
  ],
} as const satisfies OperationDefinition;

type BookParameters = {
  slot: Slot[];
  'patient-reference'?: Reference<Patient>;
  'appointment-type'?: CodeableConcept;
};

function assertAllOk<T>(objects: (Error | T)[], msg: string, path?: string): asserts objects is T[] {
  objects.forEach((obj, idx) => {
    if (obj instanceof Error) {
      throw new OperationOutcomeError(badRequest(msg, path?.replace('%i', idx.toString())));
    }
  });
}

function assertAllMatch<T>(objects: T[], msg: string): T {
  const first = objects[0];
  if (objects.some((obj) => obj !== first)) {
    throw new OperationOutcomeError(badRequest(msg));
  }
  return first;
}

/**
 * What a booking is when the caller does not say. FHIR's own default for
 * `Appointment.appointmentType`, so a booking is never left untyped.
 */
const DEFAULT_APPOINTMENT_TYPE: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
      code: 'ROUTINE',
      display: 'Routine appointment - default if not valued',
    },
  ],
};

/**
 * Collapses the service types of every booked slot into a distinct list.
 * Booking several slots of the same service would otherwise repeat it.
 * @param concepts - Service types from the slots being booked.
 * @returns The distinct concepts, in first-seen order.
 */
function dedupeConcepts(concepts: CodeableConcept[]): CodeableConcept[] {
  const seen = new Set<string>();
  const out: CodeableConcept[] = [];
  for (const concept of concepts) {
    const key = JSON.stringify(concept);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(concept);
    }
  }
  return out;
}

function serviceTypeTokens(slots: Slot[]): string[] {
  const tokenSet = new Set<string>();
  for (const slot of slots) {
    for (const concept of slot.serviceType ?? EMPTY) {
      for (const coding of concept.coding ?? EMPTY) {
        tokenSet.add(`${coding.system ?? ''}|${coding.code ?? ''}`);
      }
    }
  }
  return [...tokenSet.values()];
}

/**
 * Handles HTTP requests for the Appointment $book operation.
 *
 * Endpoints:
 *   [fhir base]/Appointment/$book
 *
 * @param req - The FHIR request.
 * @returns The FHIR response.
 */
export async function appointmentBookHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<BookParameters>(bookOperation, req);
  const proposedSlots = params.slot;

  const start = assertAllMatch(
    proposedSlots.map((slot) => slot.start),
    'Mismatched slot start times'
  );
  const end = assertAllMatch(
    proposedSlots.map((slot) => slot.end),
    'Mismatched slot end times'
  );

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (params['patient-reference']) {
    // validate that the patient reference exists and is visible to the caller
    try {
      await ctx.repo.readReference(params['patient-reference']);
    } catch (err: unknown) {
      // convert from 404 not-found to 400 bad-request
      if (err instanceof OperationOutcomeError && isNotFound(err.outcome)) {
        throw new OperationOutcomeError(badRequest('Invalid patient-reference'));
      }
      throw err;
    }
  }

  const schedules = await ctx.repo.readReferences(proposedSlots.map((slot) => slot.schedule));
  assertAllOk(schedules, 'Schedule load failed', 'Parameters.parameter[%i].schedule');

  // Validate actor lists up front (one primary actor + optional Location actors).
  schedules.forEach((schedule) => getPrimaryActor(schedule));

  const actors = await ctx.repo.readReferences(schedules.flatMap((schedule) => schedule.actor));
  assertAllOk(actors, 'Schedule.actor load failed', 'Parameters.parameter[%i].schedule.actor');

  let healthcareService: WithId<HealthcareService>;
  // We expect that at most one unique serviceType reference will be found
  const serviceRefs = proposedSlots.flatMap((slot) => extractReferencesFromCodeableReferenceLike(slot.serviceType));
  const serviceRefString = assertAllMatch(
    serviceRefs.map((ref) => ref.reference),
    'Mismatched service types'
  );

  if (serviceRefString) {
    try {
      healthcareService = await ctx.repo.readReference({ reference: serviceRefString });
    } catch (err) {
      if (err instanceof OperationOutcomeError && isNotFound(err.outcome)) {
        throw new OperationOutcomeError(badRequest('HealthcareService not found'));
      }
      throw err;
    }
  } else {
    // Collect all unique service type codes across all proposed slots, then fetch
    // matching HealthcareService resources in a single query.
    //
    // Q: Do we support this style or require the CodeableReference style above?
    const allServiceTypes = serviceTypeTokens(proposedSlots);

    const healthcareServices: WithId<HealthcareService>[] =
      allServiceTypes.length > 0
        ? await ctx.repo.searchResources<HealthcareService>({
            resourceType: 'HealthcareService',
            filters: [{ code: 'service-type', operator: Operator.EQUALS, value: allServiceTypes.join(',') }],
          })
        : [];

    if (healthcareServices.length === 0) {
      throw new OperationOutcomeError(badRequest('No matching HealthcareService found'));
    }

    if (healthcareServices.length > 1) {
      throw new OperationOutcomeError(badRequest('Multiple matching HealthcareServices found'));
    }
    healthcareService = healthcareServices[0];
  }

  const bufferSlots: Slot[] = [];

  const createdResources = await ctx.repo.withTransaction(
    async () => {
      await Promise.all(
        proposedSlots.map(async (proposedSlot, index) => {
          const scheduleRefString = getReferenceString(proposedSlot.schedule);
          const schedule = schedules.find((s) => `Schedule/${s.id}` === scheduleRefString);
          invariant(schedule, 'Slot.schedule not loaded');

          const primaryActorRef = getPrimaryActor(schedule).reference;
          const actor = actors.find((a) => `${a.resourceType}/${a.id}` === primaryActorRef);
          invariant(actor, 'Slot.schedule.actor not loaded');
          const durationMinutes = (Date.parse(proposedSlot.end) - Date.parse(proposedSlot.start)) / 60000;
          const parameters = chooseSchedulingParameters(schedule, healthcareService);

          if (parameters?.duration !== durationMinutes) {
            throw new OperationOutcomeError(badRequest('No matching scheduling parameters found'));
          }

          const timeZone = parameters.timezone ?? getTimeZone(actor);
          if (!timeZone) {
            throw new OperationOutcomeError(
              badRequest('No timezone specified', `Parameters.parameter[${index}].schedule.actor`)
            );
          }

          const range = {
            start: addMinutes(startDate, -1 * parameters.bufferBefore),
            end: addMinutes(endDate, parameters.bufferAfter),
          };
          const searchStart = range.start.toISOString();
          const searchEnd = range.end.toISOString();

          const existingSlots = await ctx.repo.searchResources<Slot>({
            resourceType: 'Slot',
            count: DEFAULT_MAX_SEARCH_COUNT,
            filters: [
              {
                code: 'schedule',
                operator: Operator.EQUALS,
                value: getReferenceString(schedule),
              },
              {
                code: 'status',
                operator: Operator.EQUALS,
                value: 'busy,busy-tentative,busy-unavailable,free',
              },
              {
                code: '_filter',
                operator: Operator.EQUALS,
                value: `((start ge "${searchStart}" and start le "${searchEnd}") or (end ge "${searchStart}" and end le "${searchEnd}") or (start lt "${searchStart}" and end gt "${searchEnd}"))`,
              },
            ],
          });

          // If we filled a full search page of slots, then there may be slots we
          // didn't fetch that would impact availability. Fail loudly here.
          if (existingSlots.length === DEFAULT_MAX_SEARCH_COUNT) {
            throw new OperationOutcomeError(badRequest('Too many existing slots found in range. Try another time.'));
          }

          // If there exists busy slots overlapping with the requested booking time,
          // we can bail out now with an informative error message.
          const explicitOverlap = existingSlots.find((existingSlot) => {
            return (
              existingSlot.status !== 'free' &&
              areIntervalsOverlapping(
                { start: startDate, end: endDate },
                { start: new Date(existingSlot.start), end: new Date(existingSlot.end) }
              )
            );
          });
          if (explicitOverlap) {
            throw new OperationOutcomeError(conflict('Requested time slot is no longer available'));
          }

          const availability = applyExistingSlots({
            availability: resolveAvailability(parameters, range, timeZone),
            slots: existingSlots,
            range,
            serviceType: healthcareService.type,
          });

          const hasAvailability = availability.some(
            (interval) => interval.start <= range.start && interval.end >= range.end
          );

          if (!hasAvailability) {
            throw new OperationOutcomeError(badRequest('No availability found at this time'));
          }

          if (parameters.bufferBefore) {
            bufferSlots.push({
              resourceType: 'Slot',
              status: 'busy-unavailable',
              start: searchStart,
              end: startDate.toISOString(),
              schedule: proposedSlot.schedule,
            });
          }

          if (parameters.bufferAfter) {
            bufferSlots.push({
              resourceType: 'Slot',
              status: 'busy-unavailable',
              start: endDate.toISOString(),
              end: searchEnd,
              schedule: proposedSlot.schedule,
            });
          }
        })
      );

      // Every Schedule actor becomes a participant: the primary actor (practitioner)
      // as tentative, Location actors (the site) as accepted. Locations shared by
      // several schedules are only listed once.
      const participant: Appointment['participant'] = [];
      const seenActors = new Set<string>();
      for (const schedule of schedules) {
        for (const actor of schedule.actor) {
          const key = actor.reference ?? '';
          if (key && seenActors.has(key)) {
            continue;
          }
          seenActors.add(key);
          participant.push({ actor, status: isLocationActor(actor) ? 'accepted' : 'tentative' });
        }
      }

      if (params['patient-reference']) {
        participant.push({
          actor: params['patient-reference'],
          status: 'accepted',
        });
      }

      const createdSlots = await Promise.all(
        proposedSlots.map((slot) =>
          ctx.repo.createResource({
            ...slot,
            status: 'busy',
          })
        )
      );
      const createdBufferSlots = await Promise.all(bufferSlots.map((slot) => ctx.repo.createResource(slot)));

      // Carry the clinical shape of the visit onto the Appointment. The slots
      // already declare what service they are for and the caller says how it is
      // to be conducted; dropping both left every booking indistinguishable from
      // every other one once it reached the chart.
      const appointmentServiceTypes = dedupeConcepts(proposedSlots.flatMap((slot) => slot.serviceType ?? EMPTY));

      const appointment = await ctx.repo.createResource<Appointment>({
        resourceType: 'Appointment',
        status: 'booked',
        slot: createdSlots.map((slot) => ({ reference: getReferenceString(slot) })),
        participant,
        start,
        end,
        appointmentType: params['appointment-type'] ?? DEFAULT_APPOINTMENT_TYPE,
        ...(appointmentServiceTypes.length > 0 ? { serviceType: appointmentServiceTypes } : {}),
      });
      return [appointment, ...createdSlots, ...createdBufferSlots];
    },
    { serializable: true }
  );

  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: createdResources.map((resource) => ({ resource })),
  };

  return [created, buildOutputParameters(bookOperation, bundle)];
}
