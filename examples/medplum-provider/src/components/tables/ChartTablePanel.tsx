// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Card, Group, Select, Text } from '@mantine/core';
import type { SearchRequest } from '@medplum/core';
import { DEFAULT_SEARCH_COUNT } from '@medplum/core';
import { setOffset } from '@medplum/react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import classes from './ChartTablePanel.module.css';

/** Page sizes offered in the footer. The server caps `_count` well above these. */
const PAGE_SIZES = ['10', '20', '50', '100'];

export interface ChartTablePanelProps {
  /** Panel heading, e.g. the patient tab label ("Visits"). */
  title: string;
  /** Total number of matching records; `undefined` renders a loading hint. */
  total?: number;
  /** Optional element rendered on the right of the header (actions). */
  action?: ReactNode;
  /** The table itself — normally a `SearchControl`. */
  children: ReactNode;
  /**
   * Fill the parent's height exactly rather than standing at least a viewport
   * tall. Use inside an already height-constrained container (the patient
   * chart's content pane), where a viewport minimum would overflow it.
   */
  fill?: boolean;
  /** Current search. Together with `onSearchChange`, enables the footer. */
  search?: SearchRequest;
  /** Called with the new search when the page or page size changes. */
  onSearchChange?: (search: SearchRequest) => void;
}

/**
 * Frames a resource table in the same card language as the dashboard panels
 * (see `pages/dashboard/components/DashboardPanel.tsx`), and caps its height so
 * the table body scrolls between a fixed header and a docked footer rather than
 * taking the column headers and the pager off-screen with it.
 *
 * The footer replaces `SearchControl`'s own pager, which is hidden by the rules
 * in `src/index.css`: it sits inside the scroll area and offers no page-size
 * control, and `SearchControl` has no prop to suppress it.
 *
 * The `ph-table-panel` class is an app-owned global styling hook — the table
 * itself is rendered by `SearchControl`, which exposes no `className`.
 *
 * @param props - Title, record count, optional header action, paging state, and the table.
 * @returns The framed table panel.
 */
export function ChartTablePanel(props: ChartTablePanelProps): JSX.Element {
  const { title, total, action, children, fill, search, onSearchChange } = props;

  return (
    <div className={classes.pane} data-fill={fill || undefined}>
      <Card
        withBorder
        shadow="sm"
        radius="lg"
        p={0}
        bg="dark.7"
        className={`${classes.panel} ph-table-panel`}
        style={{ borderColor: 'var(--mantine-color-dark-4)' }}
      >
        <Group justify="space-between" align="center" wrap="nowrap" px="md" pt="md" pb="xs">
          <div>
            <Text fw={600}>{title}</Text>
            <Text size="xs" c="dark.2">
              {total === undefined ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}`}
            </Text>
          </div>
          {action}
        </Group>
        {children}
        {search && onSearchChange && <TableFooter search={search} total={total} onSearchChange={onSearchChange} />}
      </Card>
    </div>
  );
}

interface TableFooterProps {
  readonly search: SearchRequest;
  readonly total: number | undefined;
  readonly onSearchChange: (search: SearchRequest) => void;
}

/**
 * Docked footer: which records are on screen, how many to show at a time, and
 * the page controls.
 *
 * @param props - Footer inputs.
 * @param props.search - The current search, for offset and page size.
 * @param props.total - Total matching records, when known.
 * @param props.onSearchChange - Called with the updated search.
 * @returns The footer bar.
 */
function TableFooter({ search, total, onSearchChange }: TableFooterProps): JSX.Element {
  const count = search.count ?? DEFAULT_SEARCH_COUNT;
  const offset = search.offset ?? 0;

  const start = total === 0 ? 0 : offset + 1;
  const end = total === undefined ? offset + count : Math.min(offset + count, total);
  const hasPrev = offset > 0;
  const hasNext = total !== undefined && offset + count < total;

  return (
    <Group justify="space-between" align="center" wrap="nowrap" px="md" py="xs" className={classes.footer}>
      <Text size="xs" c="dark.2">
        {total === undefined ? ' ' : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
      </Text>
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" c="dark.2">
          Rows
        </Text>
        <Select
          size="xs"
          w={76}
          data={PAGE_SIZES}
          value={String(count)}
          allowDeselect={false}
          aria-label="Results per page"
          comboboxProps={{ withinPortal: true }}
          onChange={(value) => {
            if (value) {
              // Reset to the first page: the current offset may be past the end.
              onSearchChange({ ...search, count: Number.parseInt(value, 10), offset: 0 });
            }
          }}
        />
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Previous results"
          disabled={!hasPrev}
          onClick={() => onSearchChange(setOffset(search, Math.max(0, offset - count)))}
        >
          <IconChevronLeft size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="Next results"
          disabled={!hasNext}
          onClick={() => onSearchChange(setOffset(search, offset + count))}
        >
          <IconChevronRight size={16} />
        </ActionIcon>
      </Group>
    </Group>
  );
}
