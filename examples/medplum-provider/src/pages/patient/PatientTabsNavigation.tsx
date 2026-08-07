// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Group, Paper, Tabs } from '@mantine/core';
import type { JSX, ReactNode } from 'react';
import type { PatientPageTabInfo } from './PatientPage.utils';
import classes from './PatientTabsNavigation.module.css';

interface PatientTabsNavigationProps {
  tabs: PatientPageTabInfo[];
  currentTab: string;
  onTabChange: (value: string | null) => void;
  /** Action pinned to the right of the tab strip, e.g. the timeline toggle. */
  action?: ReactNode;
}

export function PatientTabsNavigation({
  tabs,
  currentTab,
  onTabChange,
  action,
}: PatientTabsNavigationProps): JSX.Element {
  const activeTab = currentTab.toLowerCase();

  return (
    <Paper
      w="100%"
      pt={16}
      pb={0}
      px={0}
      radius={0}
      style={{ borderBottom: '1px solid var(--app-shell-border-color)' }}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Tabs
          value={activeTab}
          onChange={onTabChange}
          variant="unstyled"
          className="pill-tabs"
          style={{ minWidth: 0, flex: 1 }}
        >
          <Tabs.List className={classes.list}>
            {tabs.map((t) => (
              <Tabs.Tab key={t.id} value={t.id}>
                {t.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
        {action && <div className={classes.action}>{action}</div>}
      </Group>
    </Paper>
  );
}
