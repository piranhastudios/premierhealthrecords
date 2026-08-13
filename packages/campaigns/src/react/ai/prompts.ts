// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { TemplateBlock, TemplateDesign } from '../compile';

/**
 * Prompt builders for the template AI assistant.
 *
 * NO-PHI GUARD: prompts are built EXCLUSIVELY from the inputs below — template
 * design JSON, the operator's brief, brand copy, and merge-field placeholders
 * (never evaluated values). No Patient-derived data may enter a payload; the
 * assistant panel has no access to patient resources by construction.
 */

export type AssistantAction = 'draft' | 'rewrite' | 'subjects' | 'translate';

const BLOCK_SCHEMA = `Blocks JSON schema: {"blocks":[{"id":"<unique>","type":"heading","text":"..."} | {"id":"...","type":"text","text":"..."} | {"id":"...","type":"button","text":"...","href":"https://..."} | {"id":"...","type":"divider"} | {"id":"...","type":"spacer","height":24}]}
Merge fields may be used inside text: {{patient.name.given.first()}}, {{resource.start}}, {{clinic.name}}. Never invent other roots.`;

export const SYSTEM_PROMPT = `You are an email copywriter for Premier Health, a healthcare provider in Cameroon. You write clear, warm, professional patient emails in English or French. Keep medical claims out; keep copy compliant (no pressure tactics). Respond ONLY in the format the task asks for — no preamble, no markdown fences.`;

/**
 * Builds the user message for an assistant action.
 * @param action - The requested action.
 * @param input - Operator brief / selected block / current design.
 * @param input.brief - The operator's free-text brief or instruction.
 * @param input.block - The selected block (rewrite).
 * @param input.design - The current design (subjects / translate).
 * @param input.subject - The current subject line (subjects).
 * @param input.targetLanguage - The translation target (translate).
 * @returns The user message content.
 */
export function buildUserMessage(
  action: AssistantAction,
  input: { brief?: string; block?: TemplateBlock; design?: TemplateDesign; subject?: string; targetLanguage?: 'en' | 'fr' }
): string {
  switch (action) {
    case 'draft':
      return `Draft an email as blocks JSON for this brief: "${input.brief ?? ''}".\n${BLOCK_SCHEMA}\nRespond with ONLY the JSON object.`;
    case 'rewrite':
      return `Rewrite this email block text per the instruction "${input.brief ?? 'improve clarity and warmth'}". Respond with ONLY the rewritten text.\nText: ${JSON.stringify(
        input.block && 'text' in input.block ? input.block.text : ''
      )}`;
    case 'subjects':
      return `Suggest 5 subject lines for this email. Current subject: ${JSON.stringify(input.subject ?? '')}. Email design: ${JSON.stringify(
        input.design ?? {}
      )}\nRespond with ONLY a JSON array of 5 strings.`;
    case 'translate':
      return `Translate every "text" value and the tone of this email design to ${
        input.targetLanguage === 'fr' ? 'French' : 'English'
      }, keeping merge fields ({{...}}) untouched. Design: ${JSON.stringify(input.design ?? {})}\n${BLOCK_SCHEMA}\nRespond with ONLY the translated blocks JSON object.`;
    default:
      return '';
  }
}

/**
 * Best-effort extraction of a JSON payload from a model response (tolerates
 * stray markdown fences despite instructions).
 * @param content - The raw model response.
 * @returns The parsed value, or undefined.
 */
export function parseModelJson<T>(content: string): T | undefined {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return undefined;
  }
}
