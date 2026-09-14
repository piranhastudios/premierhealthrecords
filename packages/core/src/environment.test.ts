// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { vi } from 'vitest';
import { getBuffer, getWindow, hasLocation, isBrowserEnvironment, isNodeEnvironment, locationUtils } from './environment';

describe('Environment utils', () => {
  beforeAll(() => {
    // Suppress JSDOM warnings about location assignment
    console.error = vi.fn();
  });

  test('should run tests', () => {
    expect(() => isBrowserEnvironment()).not.toThrow();
    expect(() => isNodeEnvironment()).not.toThrow();
    expect(() => getWindow()).not.toThrow();
    expect(() => getBuffer()).not.toThrow();
    expect(() => locationUtils.assign('#foo')).not.toThrow();
    expect(() => locationUtils.reload()).not.toThrow();
    expect(() => locationUtils.getSearch()).not.toThrow();
    expect(() => locationUtils.getPathname()).not.toThrow();
    expect(() => locationUtils.getOrigin()).not.toThrow();
    expect(() => locationUtils.getLocation()).not.toThrow();
  });

  // React Native defines a global `window` but no `location`. Guarding location
  // access with isBrowserEnvironment() therefore threw "Cannot read property
  // 'protocol' of undefined", which broke MedplumClient.processCode() and with
  // it every native email/password sign-in.
  describe('React Native (window defined, location undefined)', () => {
    const realLocation = globalThis.location;

    beforeEach(() => {
      // @ts-expect-error deliberately removing location to mimic React Native
      delete globalThis.location;
    });

    afterEach(() => {
      globalThis.location = realLocation;
    });

    test('hasLocation is false even though window exists', () => {
      expect(typeof window).not.toBe('undefined');
      expect(hasLocation()).toBe(false);
    });

    test('location helpers degrade instead of throwing', () => {
      expect(() => locationUtils.assign('#foo')).not.toThrow();
      expect(() => locationUtils.reload()).not.toThrow();
      expect(locationUtils.getSearch()).toBe('');
      expect(locationUtils.getPathname()).toBe('');
      expect(locationUtils.getLocation()).toBe('');
      expect(locationUtils.getOrigin()).toBe('');
    });
  });
});
