// SPDX-FileCopyrightText: Copyright Premier Health Centres
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import { EMPTY } from '@medplum/core';
import type { Location } from '@medplum/fhirtypes';
import { useSearchResources } from '@medplum/react-hooks';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * "Current site" filter shared by the schedule and dashboard views.
 *
 * Sites are FHIR Location resources (one per clinic, seeded by
 * scripts/seed-cameroon-sites.mjs). The selection lives in a tiny module store
 * persisted to localStorage so every panel agrees without a React context.
 * `undefined` means "all sites".
 */

const STORAGE_KEY = 'phc.site';
const listeners = new Set<() => void>();

function readStoredSiteId(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

let selectedSiteId: string | undefined = readStoredSiteId();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | undefined {
  return selectedSiteId;
}

/**
 * Change the current site. Pass `undefined` for "all sites".
 * @param siteId - The Location id, or undefined.
 */
export function setSelectedSiteId(siteId: string | undefined): void {
  selectedSiteId = siteId;
  try {
    if (siteId) {
      globalThis.localStorage?.setItem(STORAGE_KEY, siteId);
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private mode); selection is still kept in memory.
  }
  listeners.forEach((listener) => listener());
}

export interface SiteFilter {
  /** Active sites, sorted by name. */
  sites: WithId<Location>[];
  loading: boolean;
  /** Selected site id, or undefined for all sites (also when the stored id is stale). */
  siteId: string | undefined;
  /** `Location/<id>` for search params, or undefined for all sites. */
  siteRef: string | undefined;
  site: WithId<Location> | undefined;
  setSiteId: (siteId: string | undefined) => void;
}

export function useSiteFilter(): SiteFilter {
  const storedId = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  const [sites, loading] = useSearchResources('Location', { status: 'active', _sort: 'name', _count: '100' });
  const site = useMemo(() => sites?.find((candidate) => candidate.id === storedId), [sites, storedId]);
  const siteId = site?.id;
  return {
    sites: sites ?? (EMPTY as unknown as WithId<Location>[]),
    loading,
    siteId,
    siteRef: siteId ? `Location/${siteId}` : undefined,
    site,
    setSiteId: setSelectedSiteId,
  };
}

/**
 * Search filter tuple for resources that carry a `location` search parameter
 * (Appointment, HealthcareService, PractitionerRole, Schedule via actor…).
 * @param siteRef - `Location/<id>` or undefined.
 * @returns Zero or one `['location', ref]` entries to spread into a search.
 */
export function siteSearchParams(siteRef: string | undefined): [string, string][] {
  return siteRef ? [['location', siteRef]] : [];
}
