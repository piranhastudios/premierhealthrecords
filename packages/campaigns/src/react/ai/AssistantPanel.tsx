// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Card, Group, Loader, Select, Stack, Text, Textarea, Title } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import type { Parameters } from '@medplum/fhirtypes';
import { IconSparkles } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import type { TemplateBlock, TemplateDesign } from '../compile';
import { auditAiGeneration } from './audit';
import type { AssistantAction } from './prompts';
import { buildUserMessage, parseModelJson, SYSTEM_PROMPT } from './prompts';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface AssistantPanelProps {
  templateId: string;
  design: TemplateDesign;
  subject: string;
  /** Replace the whole design (draft / translate). */
  onApplyDesign: (design: TemplateDesign) => void;
  /** Replace the subject line. */
  onApplySubject: (subject: string) => void;
  /** The currently selected block, for rewrite. */
  selectedBlock?: TemplateBlock;
  /** Replace the selected block's text. */
  onApplyBlockText?: (text: string) => void;
}

interface Proposal {
  action: AssistantAction;
  design?: TemplateDesign;
  subjects?: string[];
  text?: string;
}

/**
 * Template AI assistant (Phase A): draft-from-brief, rewrite selected block,
 * subject-line variants, EN↔FR translation. The AI only ever proposes —
 * nothing is applied without an explicit click. Prompts carry design JSON,
 * the brief, and merge-field placeholders only (see prompts.ts NO-PHI GUARD).
 * Every generation is recorded as an AuditEvent. Server-side enforcement of
 * the `ai` project feature comes from the $ai operation itself.
 *
 * @param props - Current template state and apply callbacks.
 * @returns The assistant panel.
 */
export function AssistantPanel(props: AssistantPanelProps): JSX.Element {
  const { templateId, design, subject, onApplyDesign, onApplySubject, selectedBlock, onApplyBlockText } = props;
  const medplum = useMedplum();
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [proposal, setProposal] = useState<Proposal>();

  const run = async (action: AssistantAction, targetLanguage?: 'en' | 'fr'): Promise<void> => {
    setLoading(true);
    setError(undefined);
    setProposal(undefined);
    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserMessage(action, { brief, block: selectedBlock, design, subject, targetLanguage }),
        },
      ];
      const response: Parameters = await medplum.post(medplum.fhirUrl('Parameters', '$ai'), {
        resourceType: 'Parameters',
        parameter: [
          { name: 'messages', valueString: JSON.stringify(messages) },
          { name: 'model', valueString: DEFAULT_MODEL },
        ],
      });
      const content = response.parameter?.find((p) => p.name === 'content')?.valueString ?? '';
      await auditAiGeneration(medplum, action, DEFAULT_MODEL, templateId);

      if (action === 'draft' || action === 'translate') {
        const parsed = parseModelJson<TemplateDesign>(content);
        if (!parsed?.blocks) {
          throw new Error('The model did not return valid blocks JSON — try again');
        }
        setProposal({ action, design: parsed });
      } else if (action === 'subjects') {
        const parsed = parseModelJson<string[]>(content);
        if (!Array.isArray(parsed)) {
          throw new Error('The model did not return subject suggestions — try again');
        }
        setProposal({ action, subjects: parsed });
      } else {
        setProposal({ action, text: content.trim() });
      }
    } catch (err) {
      setError(normalizeErrorString(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group gap={6}>
          <IconSparkles size={16} />
          <Title order={6}>AI assistant</Title>
        </Group>
        <Textarea
          placeholder="Brief, e.g. “welcome email for new patients, warm tone, mention the first consultation”"
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={4}
        />
        <Group gap={6}>
          <Button size="compact-xs" onClick={() => run('draft')} disabled={loading || !brief.trim()}>
            Draft from brief
          </Button>
          <Button size="compact-xs" variant="light" onClick={() => run('rewrite')} disabled={loading || !selectedBlock}>
            Rewrite selected
          </Button>
          <Button size="compact-xs" variant="light" onClick={() => run('subjects')} disabled={loading}>
            Subject ideas
          </Button>
          <Select
            size="xs"
            w={110}
            placeholder="Translate…"
            data={[
              { value: 'fr', label: '→ French' },
              { value: 'en', label: '→ English' },
            ]}
            value={null}
            onChange={(v) => v && run('translate', v as 'en' | 'fr')}
            disabled={loading}
          />
        </Group>
        {loading && <Loader size="xs" />}
        {error && (
          <Alert color="red" p="xs">
            {error}
          </Alert>
        )}
        {proposal && (
          <Card withBorder padding="xs" bg="var(--mantine-color-default-hover)">
            <Stack gap={6}>
              {(proposal.action === 'draft' || proposal.action === 'translate') && proposal.design && (
                <>
                  <Text size="xs">
                    Proposed {proposal.action === 'draft' ? 'draft' : 'translation'} — {proposal.design.blocks.length}{' '}
                    blocks
                  </Text>
                  <Group gap={6}>
                    <Button size="compact-xs" onClick={() => proposal.design && onApplyDesign(proposal.design)}>
                      Apply
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setProposal(undefined)}>
                      Discard
                    </Button>
                  </Group>
                </>
              )}
              {proposal.action === 'subjects' &&
                proposal.subjects?.map((s, i) => (
                  <Group key={i} gap={6} wrap="nowrap">
                    <Button size="compact-xs" variant="default" onClick={() => onApplySubject(s)}>
                      Use
                    </Button>
                    <Text size="xs">{s}</Text>
                  </Group>
                ))}
              {proposal.action === 'rewrite' && proposal.text && (
                <>
                  <Text size="xs">{proposal.text}</Text>
                  <Group gap={6}>
                    <Button size="compact-xs" onClick={() => onApplyBlockText?.(proposal.text as string)}>
                      Apply to block
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => setProposal(undefined)}>
                      Discard
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Card>
        )}
      </Stack>
    </Card>
  );
}
