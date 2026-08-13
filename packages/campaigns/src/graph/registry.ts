// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Appointment, Consent, Encounter, Patient, Resource } from '@medplum/fhirtypes';
import type { TriggerEvent } from './types';

/**
 * Registry of trigger events: which resource type fires them, how to detect a
 * match from the incoming resource, and how to resolve the enrolled patient.
 * The trigger bot's Subscriptions are static (Patient, Appointment, Encounter,
 * Consent); this registry decides which campaigns an incoming resource feeds.
 */
export interface TriggerEventDef {
  event: TriggerEvent;
  resourceType: Resource['resourceType'];
  /** True when the incoming resource represents this event. */
  matches: (resource: Resource) => boolean;
  /** Resolves the patient reference (`Patient/{id}`) to enrol, if any. */
  patientRef: (resource: Resource) => string | undefined;
}

function appointmentPatientRef(appointment: Appointment): string | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
}

export const TRIGGER_EVENTS: TriggerEventDef[] = [
  {
    event: 'patient-created',
    resourceType: 'Patient',
    matches: (resource) => resource.resourceType === 'Patient',
    patientRef: (resource) => (resource.id ? `Patient/${resource.id}` : undefined),
  },
  {
    event: 'appointment-booked',
    resourceType: 'Appointment',
    matches: (resource) => resource.resourceType === 'Appointment' && (resource).status === 'booked',
    patientRef: (resource) => appointmentPatientRef(resource as Appointment),
  },
  {
    event: 'appointment-completed',
    resourceType: 'Appointment',
    matches: (resource) => resource.resourceType === 'Appointment' && (resource).status === 'fulfilled',
    patientRef: (resource) => appointmentPatientRef(resource as Appointment),
  },
  {
    event: 'encounter-finished',
    resourceType: 'Encounter',
    matches: (resource) => resource.resourceType === 'Encounter' && (resource).status === 'finished',
    patientRef: (resource) => (resource as Encounter).subject?.reference,
  },
  {
    event: 'consent-granted',
    resourceType: 'Consent',
    matches: (resource) =>
      resource.resourceType === 'Consent' &&
      (resource).status === 'active' &&
      (resource).provision?.type === 'permit',
    patientRef: (resource) => (resource as Consent).patient?.reference,
  },
];

/**
 * Trigger event definitions applicable to an incoming resource.
 * @param resource - The resource delivered by a Subscription.
 * @returns Matching event definitions (may be several, e.g. Appointment events).
 */
export function matchingTriggerEvents(resource: Resource): TriggerEventDef[] {
  return TRIGGER_EVENTS.filter((def) => def.resourceType === resource.resourceType && def.matches(resource));
}

/**
 * Looks up a trigger event definition by name (used by manual enrolment later).
 * @param event - The trigger event name.
 * @returns The definition, or undefined.
 */
export function triggerEventByName(event: TriggerEvent): TriggerEventDef | undefined {
  return TRIGGER_EVENTS.find((def) => def.event === event);
}

/** Sanity: patient resources referenced in template merge-field contexts per event. */
export const TRIGGER_CONTEXT_TYPE: Record<TriggerEvent, Resource['resourceType'] | undefined> = {
  'patient-created': 'Patient',
  'appointment-booked': 'Appointment',
  'appointment-completed': 'Appointment',
  'encounter-finished': 'Encounter',
  'consent-granted': 'Consent',
  manual: undefined,
};

/** Patient type helper for narrowing. */
export type { Patient };
