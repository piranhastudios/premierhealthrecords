// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0

/**
 * Queue a patient-facing notice so the outbound-dispatch bot delivers it over the
 * patient's channel (WhatsApp via Twilio, else email via Resend).
 *
 * The dispatcher's Subscription only fires for a *created* child Communication whose
 * `sender` is a Practitioner and whose `partOf` header carries the channel in
 * `medium`. This helper produces exactly that shape, reusing the patient's open
 * thread when there is one so the notice lands in the same conversation staff see.
 */

import type { MedplumClient } from '@medplum/core';
import type { Appointment, Communication, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { resolvePatientEndpoint } from './channel-resolver';
import type { Channel } from './constants';
import { channelToMedium, mediumToChannel } from './constants';
import type { WhatsappTemplate } from './extensions';
import { originExtension, whatsappTemplateExtension } from './extensions';
import { createThreadHeader, findOpenThreadForPatient } from './thread';
import type { NoticeKind } from './appointments';
import { APPOINTMENT_IDENTIFIER } from './appointments';

export interface QueueNoticeOptions {
  appointment: Appointment;
  patient: Patient;
  /** Required: the dispatcher only delivers Practitioner-sent messages. */
  sender: Reference<Practitioner>;
  kind: NoticeKind;
  text: string;
  /** Optional Twilio Content template (needed for WhatsApp outside the 24h window). */
  template?: WhatsappTemplate;
}

export interface QueueNoticeResult {
  status: 'queued' | 'duplicate' | 'no-channel';
  channel?: Channel;
  communication?: Communication;
}

/** Which channel the patient can be reached on: WhatsApp first, then email. */
export function pickChannel(patient: Patient): Channel | undefined {
  if (resolvePatientEndpoint(patient, 'whatsapp')) {
    return 'whatsapp';
  }
  if (resolvePatientEndpoint(patient, 'email')) {
    return 'email';
  }
  return undefined;
}

export async function queuePatientNotice(medplum: MedplumClient, options: QueueNoticeOptions): Promise<QueueNoticeResult> {
  const { appointment, patient, sender, kind, text } = options;
  const patientRef: Reference<Patient> = { reference: `Patient/${patient.id}` };

  // Reuse the patient's open thread (its channel wins, so the notice joins the
  // conversation staff already use); otherwise open one on the best channel.
  let header = patient.id ? await findOpenThreadForPatient(medplum, patient.id) : undefined;
  let channel = header ? mediumToChannel(header.medium) : undefined;
  if (!header || !channel) {
    // No open thread, or one without a channel the dispatcher can use: open a new one.
    channel = pickChannel(patient);
    if (!channel) {
      return { status: 'no-channel' };
    }
    header = await createThreadHeader(medplum, {
      subject: patientRef,
      channel,
      recipients: [patientRef],
      topicText: 'Appointments',
    });
  }

  const identifier = {
    system: APPOINTMENT_IDENTIFIER.notice,
    value: `${appointment.id}:${kind}:${appointment.start ?? ''}`,
  };
  const extension = [originExtension('outbound')];
  if (channel === 'whatsapp' && options.template) {
    extension.push(whatsappTemplateExtension(options.template));
  }

  const child: Communication = {
    resourceType: 'Communication',
    status: 'in-progress',
    sender,
    recipient: [patientRef],
    subject: patientRef,
    partOf: [{ reference: `Communication/${header.id}` }],
    medium: [channelToMedium(channel)],
    sent: new Date().toISOString(),
    basedOn: [{ reference: `Appointment/${appointment.id}` }],
    payload: [{ contentString: text }],
    identifier: [identifier],
    extension,
  };

  const existing = await medplum.searchOne('Communication', {
    identifier: `${identifier.system}|${identifier.value}`,
  });
  if (existing) {
    return { status: 'duplicate', channel, communication: existing };
  }
  const communication = await medplum.createResourceIfNoneExist(
    child,
    `identifier=${identifier.system}|${identifier.value}`
  );
  return { status: 'queued', channel, communication };
}
