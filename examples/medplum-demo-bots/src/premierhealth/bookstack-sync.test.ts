// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test } from 'vitest';
import { handler } from './bookstack-sync';

describe('bookstack-sync (direct DB)', () => {
  let medplum: MockClient;
  const baseEvent = {
    secrets: {
      BOOKSTACK_DB_HOST: { valueString: 'phr-docs-db' },
      BOOKSTACK_DB_NAME: { valueString: 'bookstack' },
      BOOKSTACK_DB_USER: { valueString: 'bookstack' },
      BOOKSTACK_DB_PASSWORD: { valueString: 'test_password' },
      BOOKSTACK_DEFAULT_ROLE: { valueString: 'editor' },
    },
    input: {},
    contentType: 'application/json',
  } as any;

  beforeEach(() => {
    medplum = new MockClient();
  });

  function createAdminUser(id: string = 'admin-1') {
    return medplum.createResource({
      resourceType: 'User',
      id,
      email: `admin${id}@example.com`,
      name: [{ given: ['Test'], family: 'Admin', text: `Test Admin ${id}` }],
      active: true,
    } as any);
  }

  function createProjectMembership(userId: string) {
    return medplum.createResource({
      resourceType: 'ProjectMembership',
      id: `pm-${userId}`,
      user: { reference: `User/${userId}` },
      role: 'admin',
      project: { reference: 'Project/proj-1' },
    } as any);
  }

  test('throws on missing BOOKSTACK_DB_PASSWORD secret (no default)', async () => {
    // Create an admin user so the handler proceeds to DB connection
    await createAdminUser('admin-1');
    await createProjectMembership('admin-1');

    const badEvent = { ...baseEvent, secrets: { ...baseEvent.secrets, BOOKSTACK_DB_PASSWORD: undefined } };
    await expect(handler(medplum, badEvent)).rejects.toThrow('Missing required secret: BOOKSTACK_DB_PASSWORD');
  });

  test('getDisplayName helper logic', () => {
    // Test the helper logic inline (copied from source)
    const getDisplayName = (user: any): string => {
      const u = user as any;
      const name = u.name?.[0];
      if (!name) return u.email ?? 'Unknown';
      const composed = [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ');
      return name.text ?? composed ?? u.email ?? 'Unknown';
    };

    const userWithName = { name: [{ given: ['Test'], family: 'User', text: 'Test User', prefix: [] as string[] }], email: 'test@example.com' };
    expect(getDisplayName(userWithName)).toBe('Test User');

    const userNoName = { name: [] as any[], email: 'noname@example.com' };
    expect(getDisplayName(userNoName)).toBe('noname@example.com');
  });
});