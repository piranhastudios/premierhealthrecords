// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { AuditEvent } from '@medplum/fhirtypes';
import { AUDIT_AI_GENERATION, AUDIT_EVENT_TYPE_SYSTEM } from '../../constants';
import type { AssistantAction } from './prompts';

/**
 * Records an AI generation as an AuditEvent: who, which template, which action
 * and model. Prompt/response bodies are deliberately NOT stored.
 *
 * @param medplum - The Medplum client (the signed-in operator).
 * @param action - The assistant action performed.
 * @param model - The model id used.
 * @param templateId - The template Basic id the generation applied to.
 */
export async function auditAiGeneration(
  medplum: MedplumClient,
  action: AssistantAction,
  model: string,
  templateId: string
): Promise<void> {
  const profile = medplum.getProfile();
  try {
    await medplum.createResource<AuditEvent>({
      resourceType: 'AuditEvent',
      type: { system: AUDIT_EVENT_TYPE_SYSTEM, code: AUDIT_AI_GENERATION, display: 'AI generation' },
      action: 'E',
      recorded: new Date().toISOString(),
      outcome: '0',
      outcomeDesc: `template-ai:${action} model=${model}`,
      agent: [
        {
          who: profile ? createReference(profile) : undefined,
          requestor: true,
        },
      ],
      source: { observer: profile ? createReference(profile) : { display: 'campaigns' } },
      entity: [{ what: { reference: `Basic/${templateId}` } }],
    });
  } catch (err) {
    // Audit failures must not block the operator's work; they do get logged.
    console.error('AI audit event failed:', err);
  }
}
