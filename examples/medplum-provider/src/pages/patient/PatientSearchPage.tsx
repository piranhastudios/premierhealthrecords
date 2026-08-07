// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { SearchRequest } from '@medplum/core';
import { DEFAULT_SEARCH_COUNT, formatSearchQuery, parseSearchRequest } from '@medplum/core';
import { Loading, SearchControl, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChartTablePanel } from '../../components/tables/ChartTablePanel';
import { usePatient } from '../../hooks/usePatient';
import { useResourceType } from '../resource/useResourceType';
import { prependPatientPath, tableTabLabel } from './PatientPage.utils';

export function PatientSearchPage(): JSX.Element {
  const medplum = useMedplum();
  const patient = usePatient();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState<SearchRequest>();
  const [total, setTotal] = useState<number>();

  useResourceType(search?.resourceType, { onInvalidResourceType: () => navigate('..')?.catch(console.error) });

  useEffect(() => {
    if (!patient) {
      return;
    }

    const parsedSearch = parseSearchRequest(location.pathname + location.search);
    const populatedSearch = addDefaultSearchValues(parsedSearch);

    if (
      location.pathname === `/Patient/${patient.id}/${populatedSearch.resourceType}` &&
      location.search === formatSearchQuery(populatedSearch)
    ) {
      setSearch(populatedSearch);
    } else {
      navigate(`/Patient/${patient.id}/${populatedSearch.resourceType}${formatSearchQuery(populatedSearch)}`)?.catch(
        console.error
      );
    }
  }, [medplum, patient, navigate, location]);

  if (!patient || !search?.resourceType || !search.fields || search.fields.length === 0) {
    return <Loading />;
  }

  return (
    <ChartTablePanel
      title={tableTabLabel(search.resourceType)}
      total={total}
      fill
      search={search}
      onSearchChange={(next) =>
        navigate(`/Patient/${patient.id}/${search.resourceType}${formatSearchQuery(next)}`)?.catch(console.error)
      }
    >
      <SearchControl
        checkboxesEnabled={true}
        hideFilters
        search={search}
        onLoad={(e) => setTotal(e.response.total)}
        onClick={(e) =>
          navigate(`/Patient/${patient.id}/${e.resource.resourceType}/${e.resource.id}`)?.catch(console.error)
        }
        onAuxClick={(e) => window.open(`/Patient/${patient.id}/${e.resource.resourceType}/${e.resource.id}`, '_blank')}
        onNew={() => {
          navigate(prependPatientPath(patient, `/${search.resourceType}/new`))?.catch(console.error);
        }}
        onChange={(e) => {
          navigate(`/Patient/${patient.id}/${search.resourceType}${formatSearchQuery(e.definition)}`)?.catch(
            console.error
          );
        }}
      />
    </ChartTablePanel>
  );
}

function addDefaultSearchValues(search: SearchRequest): SearchRequest {
  const fields = search.fields ?? ['_id', '_lastUpdated'];
  const offset = search.offset ?? 0;
  const count = search.count ?? DEFAULT_SEARCH_COUNT;
  return {
    ...search,
    fields,
    offset,
    count,
  };
}
