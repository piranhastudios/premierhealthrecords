// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Group, NativeSelect, TextInput } from '@mantine/core';
import type { ContactPoint } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useContext, useMemo, useState } from 'react';
import { ElementsContext } from '../ElementsInput/ElementsInput.utils';
import type { ComplexTypeInputProps } from '../ResourcePropertyInput/ResourcePropertyInput.utils';
import { getErrorsForInput } from '../utils/outcomes';

export type ContactPointInputProps = ComplexTypeInputProps<ContactPoint> & {
  readonly onChange?: (value: ContactPoint | undefined) => void;
};

// International dialing codes offered for phone contact points. Cameroon (+237)
// is first/default since Premier Health operates there; other African markets and
// common diaspora countries follow. Longest-prefix matching (see splitPhoneValue)
// keeps parsing unambiguous even though codes are 1–3 digits.
const PHONE_COUNTRY_CODES: readonly string[] = [
  '+237', // Cameroon (default)
  '+234', // Nigeria
  '+254', // Kenya
  '+233', // Ghana
  '+256', // Uganda
  '+250', // Rwanda
  '+27', // South Africa
  '+225', // Côte d'Ivoire
  '+221', // Senegal
  '+44', // United Kingdom
  '+33', // France
  '+1', // United States / Canada
];
const DEFAULT_DIAL_CODE = '+237';

/**
 * Splits a stored E.164-ish value into its dialing code and national number.
 * @param value - The stored ContactPoint.value, e.g. "+237677123456".
 * @returns The dialing code (falling back to the Cameroon default) and the national number.
 */
export function splitPhoneValue(value: string | undefined): { dialCode: string; national: string } {
  if (value?.startsWith('+')) {
    // Prefer a known code (longest match); otherwise keep whatever +NNN prefix the
    // value already has so an unknown country code round-trips instead of being
    // rewritten to the default.
    const match =
      PHONE_COUNTRY_CODES.filter((code) => value.startsWith(code)).sort((a, b) => b.length - a.length)[0] ??
      /^\+\d{1,3}/.exec(value)?.[0];
    if (match) {
      return { dialCode: match, national: value.slice(match.length).replace(/[\s-]+/g, '') };
    }
  }
  return { dialCode: DEFAULT_DIAL_CODE, national: (value ?? '').replace(/[\s-]+/g, '') };
}

/**
 * Recombines a dialing code + national number into a single E.164 value.
 * @param dialCode - The international dialing code, e.g. "+237".
 * @param national - The national number, possibly containing spaces or dashes.
 * @returns The combined E.164 value, or undefined when the national number is empty.
 */
export function joinPhoneValue(dialCode: string, national: string): string | undefined {
  const trimmed = national.replace(/[\s-]+/g, '');
  return trimmed ? `${dialCode}${trimmed}` : undefined;
}

export function ContactPointInput(props: ContactPointInputProps): JSX.Element {
  const { path, outcome } = props;
  const { elementsByPath, getExtendedProps } = useContext(ElementsContext);
  const [contactPoint, setContactPoint] = useState(props.defaultValue);
  const [phone, setPhone] = useState(() => splitPhoneValue(props.defaultValue?.value));

  const [systemElement, useElement, valueElement] = useMemo(
    () => ['system', 'use', 'value'].map((field) => elementsByPath[path + '.' + field]),
    [elementsByPath, path]
  );
  const [systemProps, useProps, valueProps] = useMemo(
    () => ['system', 'use', 'value'].map((field) => getExtendedProps(path + '.' + field)),
    [getExtendedProps, path]
  );

  function setContactPointWrapper(newValue: ContactPoint | undefined): void {
    if (newValue && Object.keys(newValue).length === 0) {
      newValue = undefined;
    }
    setContactPoint(newValue);
    if (props.onChange) {
      props.onChange(newValue);
    }
  }

  function setSystem(system: 'url' | 'phone' | 'fax' | 'email' | 'pager' | 'sms' | 'other'): void {
    const newValue: ContactPoint = { ...contactPoint, system };
    if (!system) {
      delete newValue.system;
    }
    // Switching to phone: derive the dial-code + number fields from the CURRENT
    // value (not stale state captured at mount). Only rewrite the stored value
    // when the remainder is actually numeric — a non-phone value (e.g. an email
    // typed under another system) is left untouched for the user to correct.
    if (system === 'phone') {
      const parts = splitPhoneValue(contactPoint?.value);
      setPhone(parts);
      if (/^\d*$/.test(parts.national)) {
        const joined = joinPhoneValue(parts.dialCode, parts.national);
        if (joined) {
          newValue.value = joined;
        } else {
          delete newValue.value;
        }
      }
    }
    setContactPointWrapper(newValue);
  }

  function setUse(use: 'home' | 'work' | 'temp' | 'old' | 'mobile'): void {
    const newValue: ContactPoint = { ...contactPoint, use };
    if (!use) {
      delete newValue.use;
    }
    setContactPointWrapper(newValue);
  }

  function setValue(value: string): void {
    const newValue: ContactPoint = { ...contactPoint, value };
    if (!value) {
      delete newValue.value;
    }
    setContactPointWrapper(newValue);
  }

  function setPhoneParts(next: { dialCode: string; national: string }): void {
    setPhone(next);
    const joined = joinPhoneValue(next.dialCode, next.national);
    const newValue: ContactPoint = { ...contactPoint, system: 'phone', value: joined };
    if (!joined) {
      delete newValue.value;
    }
    setContactPointWrapper(newValue);
  }

  const errorPath = props.valuePath ?? path;
  const valueDisabled = props.disabled || valueProps?.readonly;
  const valueRequired = (valueElement?.min ?? 0) > 0;
  const isPhone = contactPoint?.system === 'phone';

  return (
    <Group gap="xs" grow wrap="nowrap" align="flex-start">
      <NativeSelect
        disabled={props.disabled || systemProps?.readonly}
        data-testid="system"
        defaultValue={contactPoint?.system}
        required={(systemElement?.min ?? 0) > 0}
        onChange={(e) =>
          setSystem(e.currentTarget.value as 'url' | 'phone' | 'fax' | 'email' | 'pager' | 'sms' | 'other')
        }
        data={['', 'email', 'phone', 'fax', 'pager', 'sms', 'other']}
        error={getErrorsForInput(outcome, errorPath + '.system')}
      />
      <NativeSelect
        disabled={props.disabled || useProps?.readonly}
        data-testid="use"
        defaultValue={contactPoint?.use}
        required={(useElement?.min ?? 0) > 0}
        onChange={(e) => setUse(e.currentTarget.value as 'home' | 'work' | 'temp' | 'old' | 'mobile')}
        data={['', 'home', 'work', 'temp', 'old', 'mobile']}
        error={getErrorsForInput(outcome, errorPath + '.use')}
      />
      {isPhone ? (
        <Group gap={4} wrap="nowrap" align="flex-start">
          <NativeSelect
            disabled={valueDisabled}
            data-testid="dial-code"
            aria-label="Dialing code"
            w={90}
            value={phone.dialCode}
            onChange={(e) => setPhoneParts({ ...phone, dialCode: e.currentTarget.value })}
            data={
              PHONE_COUNTRY_CODES.includes(phone.dialCode)
                ? (PHONE_COUNTRY_CODES as unknown as string[])
                : [phone.dialCode, ...PHONE_COUNTRY_CODES]
            }
          />
          <TextInput
            style={{ flex: 1 }}
            disabled={valueDisabled}
            data-testid="value"
            placeholder="Phone number"
            inputMode="tel"
            value={phone.national}
            required={valueRequired}
            onChange={(e) => setPhoneParts({ ...phone, national: e.currentTarget.value })}
            error={getErrorsForInput(outcome, errorPath + '.value')}
          />
        </Group>
      ) : (
        <TextInput
          disabled={valueDisabled}
          placeholder="Value"
          defaultValue={contactPoint?.value}
          required={valueRequired}
          onChange={(e) => setValue(e.currentTarget.value)}
          error={getErrorsForInput(outcome, errorPath + '.value')}
        />
      )}
    </Group>
  );
}
