// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { createReference, getExtension, getReferenceString, HTTP_HL7_ORG, isResource } from '@medplum/core';
import type {
  Appointment,
  ChargeItem,
  ClinicalImpression,
  CodeableConcept,
  Coding,
  Encounter,
  Patient,
  PlanDefinition,
  Practitioner,
  Reference,
  Schedule,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';
import { applyChargeItemDefinition } from './chargeitems';
import { AWAITING_PAYMENT_BUSINESS_STATUS } from './pay-gate';

const V2_0276_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0276';
const APPOINTMENT_TYPE_SYSTEM = 'https://premierhealth.cm/fhir/CodeSystem/appointment-type';

export type AppointmentTypeCode = 'ROUTINE' | 'FOLLOWUP' | 'VIRTUAL';

// Appointment types with fixed default durations (end time remains manually
// overridable in the UI). New patients get 30 minutes, follow-ups 15 minutes.
// VIRTUAL marks a video visit: the patient portal detects it by matching
// /telehealth|video|virtual/i against `appointmentType.coding` to show the
// "Join video visit" action, so the code below must keep matching that.
export const APPOINTMENT_TYPES: Record<
  AppointmentTypeCode,
  { label: string; durationMinutes: number; concept: CodeableConcept }
> = {
  ROUTINE: {
    label: 'New patient (30 min)',
    durationMinutes: 30,
    concept: {
      coding: [{ system: V2_0276_SYSTEM, code: 'ROUTINE', display: 'Routine appointment - default if not valued' }],
    },
  },
  FOLLOWUP: {
    label: 'Follow-up (15 min)',
    durationMinutes: 15,
    concept: {
      coding: [{ system: V2_0276_SYSTEM, code: 'FOLLOWUP', display: 'A follow up visit from a previous appointment' }],
    },
  },
  VIRTUAL: {
    label: 'Virtual (30 min)',
    durationMinutes: 30,
    concept: {
      coding: [{ system: APPOINTMENT_TYPE_SYSTEM, code: 'VIRTUAL', display: 'Virtual / video visit' }],
      text: 'Virtual / video visit',
    },
  },
};

export async function createAppointment(
  medplum: MedplumClient,
  start: Date,
  end: Date,
  patient: Patient,
  practitioner: Practitioner | Reference<Practitioner>,
  schedule?: Schedule,
  appointmentType?: CodeableConcept
): Promise<Appointment> {
  const practitionerRef = isResource(practitioner) ? createReference(practitioner) : practitioner;

  const appointment = await medplum.createResource({
    resourceType: 'Appointment',
    status: 'booked',
    ...(appointmentType && { appointmentType }),
    start: start.toISOString(),
    end: end.toISOString(),
    participant: [
      {
        actor: createReference(patient),
        status: 'accepted',
      },
      {
        actor: practitionerRef,
        status: 'accepted',
      },
    ],
  });

  // If we have a schedule reference, add a busy slot to prevent future
  // scheduling operations (such as $find or $book) from thinking this
  // time is free.
  if (schedule) {
    await medplum.createResource({
      resourceType: 'Slot',
      start: start.toISOString(),
      end: end.toISOString(),
      schedule: createReference(schedule),
      status: 'busy',
    });
  }

  return appointment;
}

export async function createEncounter(
  medplum: MedplumClient,
  classification: Coding,
  patient: Patient,
  planDefinition: PlanDefinition | undefined,
  appointment: Appointment,
  practitioner: Practitioner | Reference<Practitioner>,
  status: Encounter['status'] = 'planned'
): Promise<Encounter> {
  const practitionerRef = isResource(practitioner) ? createReference(practitioner) : practitioner;
  const now = new Date().toISOString();

  const encounter: Encounter = await medplum.createResource({
    resourceType: 'Encounter',
    status,
    statusHistory: [],
    classHistory: [],
    class: classification,
    subject: createReference(patient),
    appointment: [createReference(appointment)],
    participant: [{ individual: practitionerRef }],
    // Mirror updateEncounterStatus: an encounter created directly in progress (or
    // already finished) gets its period stamped, or the Visits list shows a blank.
    ...(status === 'in-progress' && { period: { start: now } }),
    ...(status === 'finished' && { period: { start: now, end: now } }),
  });

  const clinicalImpressionData: ClinicalImpression = {
    resourceType: 'ClinicalImpression',
    status: 'in-progress',
    description: 'Initial clinical impression',
    subject: createReference(patient),
    encounter: createReference(encounter),
    date: new Date().toISOString(),
  };

  await medplum.createResource(clinicalImpressionData);

  // A care template (PlanDefinition) is optional. When chosen, apply it to seed
  // the encounter's tasks/charges; otherwise create a plain encounter.
  if (planDefinition) {
    await medplum.post(medplum.fhirUrl('PlanDefinition', planDefinition.id as string, '$apply'), {
      resourceType: 'Parameters',
      parameter: [
        { name: 'subject', valueString: getReferenceString(patient) },
        { name: 'encounter', valueString: getReferenceString(encounter) },
        { name: 'practitioner', valueString: getReferenceString(practitioner) },
      ],
    });
    await createChargeItemFromPlanDefinition(medplum, encounter, patient, planDefinition);
  }
  await handleChargeItemsFromTasks(medplum, encounter, patient);

  return encounter;
}

async function createChargeItemFromPlanDefinition(
  medplum: MedplumClient,
  encounter: Encounter,
  patient: Patient,
  planDefinition: PlanDefinition
): Promise<void> {
  const serviceBillingCodeExtension = getExtension(
    planDefinition,
    `${HTTP_HL7_ORG}/fhir/uv/order-catalog/StructureDefinition/ServiceBillingCode`
  );

  const chargeDefinitionExtension = getExtension(
    planDefinition,
    'http://medplum.com/fhir/StructureDefinition/applicable-charge-definition'
  );

  if (!serviceBillingCodeExtension?.valueCodeableConcept || !chargeDefinitionExtension?.valueCanonical) {
    console.log('PlanDefinition missing required extensions for charge item creation');
    return;
  }

  const cptCoding = serviceBillingCodeExtension.valueCodeableConcept.coding?.find(
    (coding) => coding.system === 'http://www.ama-assn.org/go/cpt'
  );

  if (!cptCoding) {
    return;
  }

  const chargeItem: ChargeItem = {
    resourceType: 'ChargeItem',
    status: 'planned',
    subject: createReference(patient),
    context: createReference(encounter),
    occurrenceDateTime: new Date().toISOString(),
    code: serviceBillingCodeExtension.valueCodeableConcept,
    extension: [serviceBillingCodeExtension],
    quantity: {
      value: 1,
    },
    definitionCanonical: [chargeDefinitionExtension.valueCanonical],
  };

  const created = await medplum.createResource(chargeItem);
  // Price immediately: checkout reads the persisted priceOverride, and without
  // this the amount only lands once someone opens the encounter chart. A pricing
  // failure must not break visit creation — the chart prices lazily as a backup.
  await applyChargeItemDefinition(medplum, created).catch(console.error);
}

async function handleChargeItemsFromTasks(
  medplum: MedplumClient,
  encounter: Encounter,
  patient: Patient
): Promise<void> {
  const tasks = await medplum.search('Task', {
    encounter: getReferenceString(encounter),
  });

  if (!tasks.entry?.length) {
    return;
  }

  await Promise.all(
    tasks.entry.map(async (entry) => {
      const task = entry.resource as Task;
      const serviceRequestRef = task.focus?.reference;

      if (!serviceRequestRef?.startsWith('ServiceRequest/')) {
        return;
      }

      try {
        const serviceRequest: ServiceRequest = await medplum.readReference({
          reference: serviceRequestRef,
        });
        const chargeItem = await createChargeItemFromServiceRequest(medplum, patient, serviceRequest);
        // Pay-before-service: a billable investigation is blocked until its bill is
        // paid. The premierhealth-release-paid-tasks bot flips the task back to
        // 'ready' when the covering Invoice becomes balanced.
        if (chargeItem && task.id) {
          await medplum.updateResource<Task>({
            ...task,
            status: 'on-hold',
            businessStatus: AWAITING_PAYMENT_BUSINESS_STATUS,
          });
        }
      } catch (err) {
        console.error(`Error processing ServiceRequest ${serviceRequestRef}:`, err);
      }
    })
  );
}

async function createChargeItemFromServiceRequest(
  medplum: MedplumClient,
  patient: Patient,
  serviceRequest: ServiceRequest
): Promise<ChargeItem | undefined> {
  const chargeDefinitionExtension = getExtension(
    serviceRequest,
    'http://medplum.com/fhir/StructureDefinition/applicable-charge-definition'
  );

  if (
    !chargeDefinitionExtension?.valueCanonical ||
    !serviceRequest.code?.coding?.find((c) => c.system === 'http://www.ama-assn.org/go/cpt')
  ) {
    return undefined;
  }

  const canonicalUrl = chargeDefinitionExtension?.valueCanonical;
  const definitionCanonical = canonicalUrl ? [canonicalUrl] : [];

  const chargeItem: ChargeItem = {
    resourceType: 'ChargeItem',
    status: 'planned',
    supportingInformation: [
      {
        reference: `ServiceRequest/${serviceRequest.id}`,
      },
    ],
    subject: createReference(patient),
    context: serviceRequest.encounter,
    occurrenceDateTime: serviceRequest.occurrenceDateTime || new Date().toISOString(),
    code: serviceRequest.code || { coding: [] },
    quantity: {
      value: 1,
    },
    definitionCanonical: definitionCanonical,
  };

  const created = await medplum.createResource(chargeItem);
  // Price immediately so checkout (which reads the persisted priceOverride)
  // shows the amount even before the encounter chart is ever opened. A pricing
  // failure must not break visit creation or the pay gate itself.
  return applyChargeItemDefinition(medplum, created).catch((err) => {
    console.error(err);
    return created;
  });
}

export async function updateEncounterStatus(
  medplum: MedplumClient,
  encounter: WithId<Encounter>,
  appointment: WithId<Appointment> | undefined,
  newStatus: Encounter['status']
): Promise<WithId<Encounter>> {
  const updatedEncounter: WithId<Encounter> = {
    ...encounter,
    status: newStatus,
    ...(newStatus === 'in-progress' &&
      !encounter.period?.start && {
        period: {
          ...encounter.period,
          start: new Date().toISOString(),
        },
      }),
    ...(newStatus === 'finished' &&
      !encounter.period?.end && {
        period: {
          ...encounter.period,
          end: new Date().toISOString(),
        },
      }),
  };

  if (appointment) {
    const updatedAppointment: Appointment = appointment;
    switch (newStatus) {
      case 'cancelled':
        updatedAppointment.status = 'cancelled';
        break;
      case 'finished':
        updatedAppointment.status = 'fulfilled';
        break;
      case 'in-progress':
        updatedAppointment.status = 'checked-in';
        break;
      case 'arrived':
        updatedAppointment.status = 'arrived';
        break;
      default:
        break;
    }
    await medplum.updateResource(updatedAppointment);
  }

  return medplum.updateResource(updatedEncounter);
}
