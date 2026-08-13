// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Button, Group, Table, Text, TextInput, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { PlanDefinition } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { CAMPAIGN_GRAPH_EXTENSION, CAMPAIGN_TYPE_CODING, PLAN_TYPE_CAMPAIGN, PLAN_TYPE_SYSTEM } from '@medplum/campaigns';
import { emptyGraph } from '@medplum/campaigns/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

const STATUS_COLORS: Record<string, string> = { active: 'green', retired: 'gray', draft: 'yellow' };

/**
 * Campaign list for the project: search campaign PlanDefinitions, create a new
 * draft, duplicate an existing one, open the builder.
 *
 * @returns The campaigns admin page.
 */
export function CampaignsPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<PlanDefinition[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback((): void => {
    medplum
      .searchResources('PlanDefinition', [
        ['type', `${PLAN_TYPE_SYSTEM}|${PLAN_TYPE_CAMPAIGN}`],
        ['_sort', '-_lastUpdated'],
        ['_count', '100'],
      ])
      .then(setCampaigns)
      .catch((err) => showNotification({ color: 'red', message: normalizeErrorString(err) }));
  }, [medplum]);

  useEffect(() => load(), [load]);

  const createCampaign = async (source?: PlanDefinition): Promise<void> => {
    const name = source ? `${source.name ?? 'Campaign'} (copy)` : newName.trim();
    if (!name) {
      return;
    }
    setCreating(true);
    try {
      const created = await medplum.createResource<PlanDefinition>({
        resourceType: 'PlanDefinition',
        status: 'draft',
        name,
        title: name,
        type: CAMPAIGN_TYPE_CODING,
        extension: [
          {
            url: CAMPAIGN_GRAPH_EXTENSION,
            valueString:
              source?.extension?.find((e) => e.url === CAMPAIGN_GRAPH_EXTENSION)?.valueString ??
              JSON.stringify(emptyGraph()),
          },
        ],
      });
      setNewName('');
      await navigate(`/admin/campaigns/${created.id}`);
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Campaigns</Title>
        <Group gap="xs">
          <TextInput
            placeholder="New campaign name"
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            size="xs"
          />
          <Button size="xs" onClick={() => createCampaign()} loading={creating} disabled={!newName.trim()}>
            Create
          </Button>
        </Group>
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Version</Table.Th>
            <Table.Th>Updated</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {campaigns.map((campaign) => (
            <Table.Tr
              key={campaign.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/admin/campaigns/${campaign.id}`)?.catch(console.error)}
            >
              <Table.Td>{campaign.title ?? campaign.name}</Table.Td>
              <Table.Td>
                <Badge variant="light" color={STATUS_COLORS[campaign.status] ?? 'yellow'}>
                  {campaign.status}
                </Badge>
              </Table.Td>
              <Table.Td>{campaign.version ?? '0'}</Table.Td>
              <Table.Td>
                <Text size="sm">{new Date(campaign.meta?.lastUpdated ?? '').toLocaleString()}</Text>
              </Table.Td>
              <Table.Td>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={(e) => {
                    e.stopPropagation();
                    createCampaign(campaign).catch(console.error);
                  }}
                >
                  Duplicate
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
          {campaigns.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text c="dimmed" size="sm">
                  No campaigns yet — name one above and hit Create.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  );
}
