// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { WithId } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { getTemplateContent, searchTemplates, templateExtensions, EMAIL_TEMPLATE_CODE } from '@medplum/campaigns';
import { BrandKitEditor } from '@medplum/campaigns/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * Email template list + per-clinic brand kit. Templates are `email-template`
 * Basic resources edited in the block editor.
 *
 * @returns The templates admin page.
 */
export function TemplatesPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WithId<Basic>[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback((): void => {
    searchTemplates(medplum)
      .then(setTemplates)
      .catch((err) => showNotification({ color: 'red', message: normalizeErrorString(err) }));
  }, [medplum]);

  useEffect(() => load(), [load]);

  const createTemplate = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) {
      return;
    }
    setCreating(true);
    try {
      const created = await medplum.createResource<Basic>({
        resourceType: 'Basic',
        code: EMAIL_TEMPLATE_CODE,
        identifier: [{ system: 'https://premierhealth.cm/fhir/identifiers/email-template', value: name }],
        extension: templateExtensions({
          design: JSON.stringify({ blocks: [] }),
          html: '<p></p>',
          subject: name,
          version: 0,
        }),
      });
      setNewName('');
      await navigate(`/admin/templates/${created.id}`);
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Stack gap="md">
      <BrandKitEditor
        onSaved={() => showNotification({ color: 'green', message: 'Brand kit saved' })}
        onError={(message) => showNotification({ color: 'red', message })}
      />
      <Group justify="space-between">
        <Title order={3}>Email templates</Title>
        <Group gap="xs">
          <TextInput placeholder="New template name" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} size="xs" />
          <Button size="xs" onClick={createTemplate} loading={creating} disabled={!newName.trim()}>
            Create
          </Button>
        </Group>
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Subject</Table.Th>
            <Table.Th>Version</Table.Th>
            <Table.Th>Updated</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {templates.map((template) => {
            const content = getTemplateContent(template);
            return (
              <Table.Tr
                key={template.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/admin/templates/${template.id}`)?.catch(console.error)}
              >
                <Table.Td>{template.identifier?.[0]?.value ?? template.id}</Table.Td>
                <Table.Td>{content?.subject}</Table.Td>
                <Table.Td>{content?.version ?? 0}</Table.Td>
                <Table.Td>
                  <Text size="sm">{new Date(template.meta?.lastUpdated ?? '').toLocaleString()}</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
          {templates.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed" size="sm">
                  No templates yet — name one above and hit Create.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
