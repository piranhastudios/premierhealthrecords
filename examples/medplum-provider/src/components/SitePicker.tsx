// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import { Select } from '@mantine/core';
import { IconMapPin } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useSiteFilter } from '../hooks/useSiteFilter';

const ALL_SITES = '__all__';

export interface SitePickerProps {
  /** Width passed to the Select. */
  w?: number | string;
  /** Hide the picker entirely when the clinic has a single site (default true). */
  hideWhenSingle?: boolean;
}

/**
 * Global site (Location) selector. Writes to the shared site filter so the
 * schedule, dashboard and queue narrow to one clinic. "All sites" clears it.
 * @param props - See {@link SitePickerProps}.
 * @returns The picker, or null while loading / when there is nothing to pick.
 */
export function SitePicker(props: SitePickerProps): JSX.Element | null {
  const { w = 260, hideWhenSingle = true } = props;
  const { sites, siteId, setSiteId, loading } = useSiteFilter();

  if (loading || sites.length === 0 || (hideWhenSingle && sites.length === 1)) {
    return null;
  }

  return (
    <Select
      w={w}
      aria-label="Site"
      leftSection={<IconMapPin size={16} />}
      value={siteId ?? ALL_SITES}
      onChange={(value) => setSiteId(value && value !== ALL_SITES ? value : undefined)}
      data={[
        { value: ALL_SITES, label: 'All sites' },
        ...sites.map((site) => ({ value: site.id, label: site.name ?? site.id })),
      ]}
      allowDeselect={false}
    />
  );
}
