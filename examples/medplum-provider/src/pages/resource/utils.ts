// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { ResourceType } from '@medplum/fhirtypes';

// Premier Health is an international (Cameroon) deployment, so resources are
// edited against base FHIR R4 rather than the US-national US Core profiles
// (which would require loading US Core StructureDefinitions and impose US-only
// constraints like us-core-patient / us-core-implantable-device).
export const RESOURCE_PROFILE_URLS: Partial<Record<ResourceType, string>> = {
  ServiceRequest: 'http://medplum.com/StructureDefinition/medplum-provider-lab-procedure-servicerequest',
};
