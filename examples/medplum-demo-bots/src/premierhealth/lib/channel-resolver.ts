// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Endpoint resolver. The channel itself is chosen by staff (stored on the thread
 * header's `medium`); this only resolves *which contact value* to send to for that
 * channel from `Patient.telecom`.
 */

import type { Patient } from '@medplum/fhirtypes';
import type { Channel } from './constants';
import { normalizeE164 } from './phone';

// Resolve the destination address for a patient on a given channel.
//   patient has no usable contact point for that channel.
export function resolvePatientEndpoint(patient: Patient, channel: Channel): string | undefined {
  const telecom = patient.telecom ?? [];
  if (channel === 'whatsapp') {
    const phone =
      telecom.find((t) => t.system === 'phone' && t.value)?.value ??
      telecom.find((t) => t.system === 'sms' && t.value)?.value;
    return phone ? normalizeE164(phone) : undefined;
  }
  const email = telecom.find((t) => t.system === 'email' && t.value)?.value;
  return email ? email.trim().toLowerCase() : undefined;
}
