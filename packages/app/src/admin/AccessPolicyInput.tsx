// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Select } from '@mantine/core';
import { createReference, isResource } from '@medplum/core';
import type { AccessPolicy, Reference } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

export interface AccessPolicyInputProps {
  readonly name: string;
  readonly defaultValue?: AccessPolicy | Reference<AccessPolicy>;
  readonly onChange: (value: Reference<AccessPolicy> | undefined) => void;
}

/**
 * Resolves the AccessPolicy id from a default value (resource or reference).
 * @param defaultValue - The default value, if any.
 * @returns The policy id, or null when unset.
 */
function defaultPolicyId(defaultValue: AccessPolicy | Reference<AccessPolicy> | undefined): string | null {
  if (!defaultValue) {
    return null;
  }
  if (isResource(defaultValue)) {
    return defaultValue.id ?? null;
  }
  return defaultValue.reference?.split('/')[1] ?? null;
}

/**
 * Access policy picker — a dropdown of the project's access policies, so
 * admins choose from what exists instead of typing into a blind autocomplete.
 * A project has few policies (front desk, nurse, patient, …), so they are all
 * loaded up front.
 *
 * @param props - Field name, optional default, and the change callback.
 * @returns The access policy select.
 */
export function AccessPolicyInput(props: AccessPolicyInputProps): JSX.Element {
  const medplum = useMedplum();
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [value, setValue] = useState<string | null>(defaultPolicyId(props.defaultValue));

  useEffect(() => {
    let active = true;
    medplum
      .searchResources('AccessPolicy', '_count=100&_sort=name')
      .then((result) => active && setPolicies(result))
      .catch(() => active && setPolicies([]));
    return () => {
      active = false;
    };
  }, [medplum]);

  return (
    <Select
      id={props.name}
      name={props.name}
      placeholder="Select access policy"
      data={policies.map((policy) => ({ value: policy.id ?? '', label: policy.name ?? policy.id ?? 'Untitled policy' }))}
      value={value}
      searchable
      clearable
      nothingFoundMessage="No access policies found"
      onChange={(id) => {
        setValue(id);
        const policy = policies.find((p) => p.id === id);
        props.onChange(policy ? createReference(policy) : undefined);
      }}
    />
  );
}
