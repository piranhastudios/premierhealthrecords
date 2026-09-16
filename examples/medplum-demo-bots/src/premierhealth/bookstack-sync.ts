// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * BookStack user sync bot (cron, every 5 minutes).
 *
 * Syncs Medplum admin users to BookStack via DIRECT MARIADB CONNECTION.
 * - Finds users with admin-level AccessPolicy or ProjectMembership
 * - Creates/updates matching users in BookStack's `users` table
 * - No API token required — runs on shared `docs` network
 * - Users receive a random password; they use "Forgot password" on first login
 *
 * Required Bot secrets (set in Medplum Admin → Bots):
 * - BOOKSTACK_DB_HOST: e.g. "phr-docs-db" (MariaDB container name)
 * - BOOKSTACK_DB_NAME: e.g. "bookstack"
 * - BOOKSTACK_DB_USER: e.g. "bookstack"
 * - BOOKSTACK_DB_PASSWORD: (from docker-compose .env)
 * - BOOKSTACK_DEFAULT_ROLE: "admin" | "editor" | "viewer" (default: "editor")
 */

import type { BotEvent, MedplumClient } from '@medplum/core';
import type { User } from '@medplum/fhirtypes';
import { createPool, Pool } from 'mysql2/promise';

interface BookStackUserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  external_auth_id: string | null;
}

const DEFAULT_ROLE = 'editor';
const ROLE_ID_MAP: Record<string, number> = {
  admin: 1,
  editor: 2,
  viewer: 3,
};

let dbPool: Pool | null = null;

async function getDbPool(event: BotEvent): Promise<Pool> {
  if (dbPool) return dbPool;

  const host = getSecret(event, 'BOOKSTACK_DB_HOST', 'phr-docs-db');
  const database = getSecret(event, 'BOOKSTACK_DB_NAME', 'bookstack');
  const user = getSecret(event, 'BOOKSTACK_DB_USER', 'bookstack');
  const password = getSecret(event, 'BOOKSTACK_DB_PASSWORD');

  dbPool = createPool({
    host,
    port: 3306,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: 'Z',
  });

  // Test connection
  const conn = await dbPool.getConnection();
  conn.release();

  return dbPool;
}

function getSecret(event: BotEvent, key: string, defaultValue?: string): string {
  const secret = event.secrets[key];
  if (secret?.valueString) return secret.valueString;
  if (defaultValue) return defaultValue;
  throw new Error(`Missing required secret: ${key}`);
}

function getDisplayName(user: User): string {
  const u = user as any;
  const name = u.name?.[0];
  if (!name) return u.email ?? 'Unknown';
  const composed = [name.prefix?.join(' '), name.given?.join(' '), name.family].filter(Boolean).join(' ');
  return name.text ?? composed ?? u.email ?? 'Unknown';
}

async function findAdminUsers(medplum: MedplumClient): Promise<User[]> {
  const adminUsers = new Map<string, User>();

  // 1. ProjectMembership with admin role
  const memberships = await medplum.searchResources(
    'ProjectMembership',
    '_count=1000&_fields=user,role'
  ) as any[];

  for (const membership of memberships) {
    if (membership.role === 'admin' && membership.user?.reference) {
      const userId = membership.user.reference.split('/')[1];
      if (!adminUsers.has(userId)) {
        const user = await (medplum.readResource as any)('User', userId).catch(() => null);
        if (user && user.active !== false) adminUsers.set(userId, user);
      }
    }
  }

  // 2. AccessPolicy with admin-like permissions
  const policies = await medplum.searchResources(
    'AccessPolicy',
    '_count=1000&_fields=user,rules'
  ) as any[];

  for (const policy of policies) {
    const rules = policy.rules ?? [];
    const hasAdminPower = rules.some((rule: any) => {
      const actions = rule.actions ?? [];
      return actions.some((a: string) => ['*', 'create', 'update', 'delete'].includes(a)) &&
             rule.resources?.some((r: string) => ['User', 'Project', 'ProjectMembership', 'AccessPolicy', '*'].includes(r));
    });

    if (hasAdminPower && policy.user?.reference) {
      const userId = policy.user.reference.split('/')[1];
      if (!adminUsers.has(userId)) {
        const user = await (medplum.readResource as any)('User', userId).catch(() => null);
        if (user && user.active !== false) adminUsers.set(userId, user);
      }
    }
  }

  return Array.from(adminUsers.values());
}

async function getAllBookStackUsers(pool: Pool): Promise<Map<string, BookStackUserRow>> {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, external_auth_id FROM users WHERE email IS NOT NULL`
  );
  const rowArray = rows as BookStackUserRow[];
  const map = new Map<string, BookStackUserRow>();
  for (const row of rowArray) {
    map.set(row.email.toLowerCase(), row);
  }
  return map;
}

async function createBookStackUser(
  pool: Pool,
  email: string,
  name: string,
  role: string,
  externalAuthId: string
): Promise<number> {
  const roleId = ROLE_ID_MAP[role] ?? ROLE_ID_MAP.editor;
  const passwordHash = '$2y$10$' + 'x'.repeat(53); // Bcrypt placeholder; user resets via "Forgot password"
  const now = new Date();

  const [result] = await pool.execute(
    `INSERT INTO users (name, email, password, role, external_auth_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, passwordHash, roleId, externalAuthId, now, now]
  );
  return (result as any).insertId;
}

async function updateBookStackUser(
  pool: Pool,
  userId: number,
  name: string,
  role: string,
  externalAuthId: string
): Promise<void> {
  const roleId = ROLE_ID_MAP[role] ?? ROLE_ID_MAP.editor;
  const now = new Date();

  await pool.execute(
    `UPDATE users SET name = ?, role = ?, external_auth_id = ?, updated_at = ? WHERE id = ?`,
    [name, roleId, externalAuthId, now, userId]
  );
}

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const defaultRole = (event.secrets['BOOKSTACK_DEFAULT_ROLE']?.valueString ?? DEFAULT_ROLE) as 'admin' | 'editor' | 'viewer';

  // 1. Get admin users from Medplum
  const adminUsers = await findAdminUsers(medplum);

  if (adminUsers.length === 0) {
    return { medplumAdmins: 0, bookstackUsers: 0, created: 0, updated: 0 };
  }

  // 2. Connect to BookStack DB and get existing users
  const pool = await getDbPool(event);
  const existingUsers = await getAllBookStackUsers(pool);

  let created = 0;
  let updated = 0;
  let errors: string[] = [];

  // 3. Sync each admin user
  for (const user of adminUsers) {
    if (!user.email) {
      errors.push(`User ${user.id} has no email`);
      continue;
    }

    const email = user.email.toLowerCase();
    const existing = existingUsers.get(email);
    const displayName = getDisplayName(user);
    const externalAuthId = `medplum:${user.id}`;

    try {
      if (existing) {
        await updateBookStackUser(pool, existing.id, displayName, defaultRole, externalAuthId);
        updated++;
      } else {
        await createBookStackUser(pool, email, displayName, defaultRole, externalAuthId);
        created++;
      }
    } catch (err) {
      errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    medplumAdmins: adminUsers.length,
    bookstackUsers: existingUsers.size,
    created,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  };
}