// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button } from '@mantine/core';
import type { Filter, SearchRequest, SortRule } from '@medplum/core';
import { DEFAULT_SEARCH_COUNT, formatSearchQuery, isReference, parseSearchRequest } from '@medplum/core';
import type { Patient, Reference, Resource, UserConfiguration } from '@medplum/fhirtypes';
import { Loading, SearchControl, useMedplum } from '@medplum/react';
import { IconPlus } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChartTablePanel } from '../components/tables/ChartTablePanel';
import { useResourceType } from './resource/useResourceType';

export function SearchPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState<SearchRequest>();
  const [total, setTotal] = useState<number>();

  useEffect(() => {
    const parsedSearch = parseSearchRequest(location.pathname + location.search);

    const populatedSearch = addSearchValues(parsedSearch, medplum.getUserConfiguration());

    if (
      location.pathname === `/${populatedSearch.resourceType}` &&
      location.search === formatSearchQuery(populatedSearch)
    ) {
      saveLastSearch(populatedSearch);
      setSearch(populatedSearch);
    } else {
      navigate(`/${populatedSearch.resourceType}${formatSearchQuery(populatedSearch)}`)?.catch(console.error);
    }
  }, [medplum, navigate, location]);

  useResourceType(search?.resourceType, { onInvalidResourceType: () => navigate('..')?.catch(console.error) });

  if (!search?.resourceType || !search.fields || search.fields.length === 0) {
    return <Loading />;
  }

  const resourceType = search.resourceType;

  return (
    <ChartTablePanel
      title={pluralizeResourceType(resourceType)}
      total={total}
      search={search}
      onSearchChange={(next) => navigate(`/${resourceType}${formatSearchQuery(next)}`)?.catch(console.error)}
      action={
        <Button
          size="xs"
          leftSection={<IconPlus size={16} />}
          onClick={() => navigate(`/${resourceType}/new`)?.catch(console.error)}
        >
          New {singularizeResourceType(resourceType)}
        </Button>
      }
    >
      <SearchControl
        checkboxesEnabled={true}
        hideFilters
        search={search}
        onLoad={(e) => setTotal(e.response.total)}
        onClick={(e) => navigate(getResourceUrl(e.resource))?.catch(console.error)}
        onAuxClick={(e) => window.open(getResourceUrl(e.resource), '_blank')}
        onNew={() => {
          navigate(`/${resourceType}/new`)?.catch(console.error);
        }}
        onChange={(e) => {
          navigate(`/${resourceType}${formatSearchQuery(e.definition)}`)?.catch(console.error);
        }}
      />
    </ChartTablePanel>
  );
}

/**
 * Splits a FHIR resource type into words, e.g. `DiagnosticReport` -> `Diagnostic Report`.
 *
 * @param resourceType - The FHIR resource type.
 * @returns The spaced form.
 */
function spaceResourceType(resourceType: string): string {
  return resourceType.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Page title for a resource list, e.g. `Patient` -> `Patients`.
 *
 * @param resourceType - The FHIR resource type being listed.
 * @returns The pluralized, spaced label.
 */
function pluralizeResourceType(resourceType: string): string {
  const spaced = spaceResourceType(resourceType);
  if (spaced.endsWith('s')) {
    return spaced;
  }
  if (spaced.endsWith('y')) {
    return `${spaced.slice(0, -1)}ies`;
  }
  return `${spaced}s`;
}

/**
 * Lower-cased singular label for the "New …" action, e.g. `Patient` -> `patient`.
 *
 * @param resourceType - The FHIR resource type being listed.
 * @returns The label to follow "New ".
 */
function singularizeResourceType(resourceType: string): string {
  return spaceResourceType(resourceType).toLowerCase();
}

/**
 * Columns used the first time a resource type is opened, before the user has
 * saved a search. Without these the table falls back to `_id` — a page of raw
 * UUIDs. Only resource types reachable from the nav are listed; anything else
 * keeps the generic fallback.
 */
const DEFAULT_FIELDS: Record<string, string[]> = {
  Patient: ['name', 'birthDate', 'gender', 'telecom', '_lastUpdated'],
  Practitioner: ['name', 'telecom', '_lastUpdated'],
  Organization: ['name', 'telecom', '_lastUpdated'],
};

function addSearchValues(search: SearchRequest, config: UserConfiguration | undefined): SearchRequest {
  const resourceType = search.resourceType || getDefaultResourceType(config);
  const fields = search.fields ?? DEFAULT_FIELDS[resourceType] ?? ['_id', '_lastUpdated'];
  const filters = search.filters ?? (!search.resourceType ? getDefaultFilters(resourceType) : undefined);
  const sortRules = search.sortRules ?? getDefaultSortRules(resourceType);
  const offset = search.offset ?? 0;
  const count = search.count ?? DEFAULT_SEARCH_COUNT;

  return {
    ...search,
    resourceType,
    fields,
    filters,
    sortRules,
    offset,
    count,
  };
}

function getDefaultResourceType(config: UserConfiguration | undefined): string {
  return (
    localStorage.getItem('defaultResourceType') ??
    config?.option?.find((o) => o.id === 'defaultResourceType')?.valueString ??
    'Task'
  );
}

function getDefaultFilters(resourceType: string): Filter[] | undefined {
  return getLastSearch(resourceType)?.filters;
}

function getDefaultSortRules(resourceType: string): SortRule[] {
  const lastSearch = getLastSearch(resourceType);
  if (lastSearch?.sortRules) {
    return lastSearch.sortRules;
  }
  return [{ code: '_lastUpdated', descending: true }];
}

function getLastSearch(resourceType: string): SearchRequest | undefined {
  const value = localStorage.getItem(resourceType + '-defaultSearch');
  return value ? (JSON.parse(value) as SearchRequest) : undefined;
}

function saveLastSearch(search: SearchRequest): void {
  localStorage.setItem('defaultResourceType', search.resourceType);
  localStorage.setItem(search.resourceType + '-defaultSearch', JSON.stringify(search));
}

function getResourceUrl<T extends Resource>(resource: T): string {
  const patientFields = ['patient', 'subject', 'sender'] as (keyof T)[];
  for (const key of patientFields) {
    if (key in resource) {
      const value = resource[key];
      if (isPatientReference(value)) {
        return `/${value.reference}/${resource.resourceType}/${resource.id}`;
      }
    }
  }
  return `/${resource.resourceType}/${resource.id}`;
}

function isPatientReference(input: unknown): input is Reference<Patient> & { reference: string } {
  return isReference(input) && input.reference.startsWith('Patient/');
}
