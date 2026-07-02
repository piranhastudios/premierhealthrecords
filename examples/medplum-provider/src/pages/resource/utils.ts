// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ResourceType } from '@medplum/fhirtypes';

// Premier Health is an international (Cameroon) deployment, so resources are
// edited against base FHIR R4 rather than the US-national US Core profiles
// (which would require loading US Core StructureDefinitions and impose US-only
// constraints like us-core-patient / us-core-implantable-device).
export const RESOURCE_PROFILE_URLS: Partial<Record<ResourceType, string>> = {
  // Premier Health Patient profile: telecom required, deceased[x] removed, and the
  // snapshot element order drives the form field order (name, birthDate, gender, telecom, ...).
  // See examples/medplum-provider/data/README.md for upload instructions.
  Patient: 'https://premierhealth.cm/fhir/StructureDefinition/premier-health-patient',
  ServiceRequest: 'http://medplum.com/StructureDefinition/medplum-provider-lab-procedure-servicerequest',
};
