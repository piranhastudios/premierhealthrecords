// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Paper, ScrollArea } from '@mantine/core';
import { Container, InfoBar, LinkTabs, Panel, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { Outlet } from 'react-router';
import { getProjectId } from '../utils';

const ADMIN_TABS = ['Details', 'Users', 'Clients', 'Bots', 'Secrets', 'Sites', 'QuickBooks', 'Campaigns', 'Templates'];
/** Marketing operators are not project admins — they only get the campaign tools. */
const MARKETING_TABS = ['Campaigns', 'Templates'];

export function ProjectPage(): JSX.Element {
  const medplum = useMedplum();
  const projectId = getProjectId(medplum);
  const isAdmin = medplum.isProjectAdmin() || medplum.isSuperAdmin();

  // `admin/projects/{id}` is admin-only and 403s for marketing operators, so
  // only admins read it; everyone else falls back to the session's project.
  const result = useMemo(
    () => (isAdmin ? medplum.get('admin/projects/' + projectId).read() : undefined),
    [medplum, projectId, isAdmin]
  );
  const projectName = result?.project?.name ?? medplum.getProject()?.name ?? '';

  return (
    <>
      <Paper>
        <InfoBar>
          <InfoBar.Entry>
            <InfoBar.Key>Project</InfoBar.Key>
            <InfoBar.Value>{projectName}</InfoBar.Value>
          </InfoBar.Entry>
        </InfoBar>
        <ScrollArea>
          <LinkTabs baseUrl="/admin" tabs={isAdmin ? ADMIN_TABS : MARKETING_TABS} />
        </ScrollArea>
      </Paper>
      <Container maw="100%">
        <Panel>
          <Outlet />
        </Panel>
      </Container>
    </>
  );
}
