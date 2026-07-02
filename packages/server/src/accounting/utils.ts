// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Project, ProjectSetting } from '@medplum/fhirtypes';
import type { SystemRepository } from '../fhir/repo';
import type { QuickBooksProvider, QuickBooksTokens } from './quickbooks';

/**
 * Upserts (by name) secret entries into a Project.secret array without touching
 * unrelated secrets.
 * @param existing - The current Project.secret array.
 * @param values - Secret name/value pairs to set.
 * @returns The merged secret array.
 */
export function upsertProjectSettings(
  existing: ProjectSetting[] | undefined,
  values: Record<string, string>
): ProjectSetting[] {
  const result = (existing ?? []).filter((s) => !(s.name && s.name in values));
  for (const [name, valueString] of Object.entries(values)) {
    result.push({ name, valueString });
  }
  return result;
}

/**
 * Persists a rotated QuickBooks token set back into project secrets. Intuit
 * refresh tokens rotate on every refresh; failing to persist the new one bricks
 * the connection until an admin re-runs the connect flow. The Project is re-read
 * so a concurrent secret edit is not clobbered wholesale.
 * @param systemRepo - A system repository (project secret writes require elevation).
 * @param projectId - The project id.
 * @param tokens - The rotated token set from the provider.
 */
export async function persistQuickBooksTokens(
  systemRepo: SystemRepository,
  projectId: string,
  tokens: QuickBooksTokens
): Promise<void> {
  const project = await systemRepo.readResource<Project>('Project', projectId);
  await systemRepo.updateResource<Project>({
    ...project,
    secret: upsertProjectSettings(project.secret, {
      QUICKBOOKS_REFRESH_TOKEN: tokens.refreshToken,
      QUICKBOOKS_ACCESS_TOKEN: tokens.accessToken,
      QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT: tokens.accessTokenExpiresAt,
    }),
  });
}

/**
 * Persists the provider's rotated tokens, if a refresh happened during the call.
 * Safe to call unconditionally (e.g. from a `finally` block).
 * @param systemRepo - A system repository.
 * @param projectId - The project id.
 * @param provider - The provider that may have refreshed tokens.
 */
export async function persistRotatedTokensIfAny(
  systemRepo: SystemRepository,
  projectId: string,
  provider: QuickBooksProvider
): Promise<void> {
  const rotated = provider.getRotatedTokens();
  if (rotated) {
    await persistQuickBooksTokens(systemRepo, projectId, rotated);
  }
}
