// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import '@xyflow/react/dist/style.css';
import { Box } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { CampaignBuilder } from '@medplum/campaigns/react';
import type { JSX } from 'react';
import { useParams } from 'react-router';

/**
 * Full-height wrapper for the campaign builder canvas.
 *
 * @returns The builder page.
 */
export function CampaignBuilderPage(): JSX.Element {
  const { campaignId } = useParams() as { campaignId: string };
  return (
    <Box h="calc(100vh - 220px)" mih={480}>
      <CampaignBuilder
        campaignId={campaignId}
        onActivated={() => showNotification({ color: 'green', message: 'Campaign activated' })}
      />
    </Box>
  );
}
