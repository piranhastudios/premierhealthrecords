// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { stringify } from '@medplum/core';
import type { ContactPoint } from '@medplum/fhirtypes';
import { act, fireEvent, render, screen } from '../test-utils/render';
import { ContactPointInput } from './ContactPointInput';

describe('ContactPointInput', () => {
  test('Renders', () => {
    render(
      <ContactPointInput
        name="test"
        path="test"
        onChange={jest.fn()}
        outcome={undefined}
        defaultValue={{ system: 'email', value: 'abc@example.com' }}
      />
    );

    const system = screen.getByTestId<HTMLInputElement>('system');
    expect(system).toBeDefined();
    expect(system.value).toEqual('email');

    const value = screen.getByPlaceholderText<HTMLInputElement>('Value');
    expect(value).toBeDefined();
    expect(value.value).toEqual('abc@example.com');
  });

  test('Change events', async () => {
    let lastValue: ContactPoint | undefined = undefined;

    render(
      <ContactPointInput
        name="test"
        path="test"
        outcome={undefined}
        defaultValue={{}}
        onChange={(value) => (lastValue = value)}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('use'), {
        target: { value: 'home' },
      });
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('system'), {
        target: { value: 'email' },
      });
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Value'), {
        target: { value: 'xyz@example.com' },
      });
    });

    expect(lastValue).toBeDefined();
    expect(lastValue).toMatchObject({
      use: 'home',
      system: 'email',
      value: 'xyz@example.com',
    });
  });

  test('Phone renders dial code and national number', () => {
    render(
      <ContactPointInput
        name="test"
        path="test"
        onChange={jest.fn()}
        outcome={undefined}
        defaultValue={{ system: 'phone', value: '+237677000111' }}
      />
    );

    const dialCode = screen.getByTestId<HTMLSelectElement>('dial-code');
    expect(dialCode.value).toEqual('+237');

    const value = screen.getByTestId<HTMLInputElement>('value');
    expect(value.value).toEqual('677000111');
  });

  test('Phone dial code + number combine into E.164 value', async () => {
    let lastValue: ContactPoint | undefined = undefined;

    render(
      <ContactPointInput
        name="test"
        path="test"
        outcome={undefined}
        defaultValue={{}}
        onChange={(value) => (lastValue = value)}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('system'), { target: { value: 'phone' } });
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('dial-code'), { target: { value: '+254' } });
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('value'), { target: { value: '712 345 678' } });
    });

    expect(lastValue).toMatchObject({ system: 'phone', value: '+254712345678' });
  });

  test('Switching a non-phone value to phone does not corrupt it', async () => {
    let lastValue: ContactPoint | undefined = undefined;

    render(
      <ContactPointInput
        name="test"
        path="test"
        outcome={undefined}
        defaultValue={{ system: 'email', value: 'jane@example.com' }}
        onChange={(value) => (lastValue = value)}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('system'), { target: { value: 'phone' } });
    });

    // The email address must not be rewritten to "+237jane@example.com".
    expect(lastValue).toMatchObject({ system: 'phone', value: 'jane@example.com' });
  });

  test('Unknown dial code round-trips instead of falling back to +237', async () => {
    let lastValue: ContactPoint | undefined = undefined;

    render(
      <ContactPointInput
        name="test"
        path="test"
        outcome={undefined}
        defaultValue={{ system: 'phone', value: '+49123456789' }}
        onChange={(value) => (lastValue = value)}
      />
    );

    const dialCode = screen.getByTestId<HTMLSelectElement>('dial-code');
    expect(dialCode.value.startsWith('+49')).toBe(true);

    await act(async () => {
      fireEvent.change(screen.getByTestId('value'), { target: { value: '999' } });
    });

    expect((lastValue as ContactPoint | undefined)?.value?.startsWith(dialCode.value)).toBe(true);
    expect((lastValue as ContactPoint | undefined)?.value?.includes('+237')).toBe(false);
  });

  test('Set blanks', async () => {
    let lastValue: ContactPoint | undefined = undefined;

    render(
      <ContactPointInput
        name="test"
        path="test"
        outcome={undefined}
        defaultValue={{
          use: 'home',
          system: 'email',
          value: 'abc@example.com',
        }}
        onChange={(value) => (lastValue = value)}
      />
    );

    await act(async () => {
      fireEvent.change(screen.getByTestId('use'), { target: { value: '' } });
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId('system'), { target: { value: '' } });
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Value'), {
        target: { value: '' },
      });
    });

    expect(stringify(lastValue)).toStrictEqual('');
  });
});
