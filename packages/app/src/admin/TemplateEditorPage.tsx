// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { TemplateEditor } from '@medplum/campaigns/react';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useParams } from 'react-router';

/**
 * Full-height wrapper for the email template block editor. The AI assistant is
 * only mounted when the project has the `ai` feature (the $ai operation
 * enforces the same gate server-side).
 *
 * @returns The template editor page.
 */
export function TemplateEditorPage(): JSX.Element {
  const medplum = useMedplum();
  const { templateId } = useParams() as { templateId: string };
  const aiEnabled = Boolean(medplum.getProject()?.features?.includes('ai'));
  return (
    <Box h="calc(100vh - 220px)" mih={480}>
      <TemplateEditor
        templateId={templateId}
        aiEnabled={aiEnabled}
        onSaved={() => showNotification({ color: 'green', message: 'Template saved' })}
      />
    </Box>
  );
}
