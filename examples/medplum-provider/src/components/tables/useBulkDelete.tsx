// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { ResourceType } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';

export interface BulkDelete {
  /** Hand this to `SearchControl`'s `onDelete` — it receives the selected ids. */
  readonly requestDelete: (ids: string[]) => void;
  /** Render this once near the table; it hosts the confirmation dialog. */
  readonly confirmElement: JSX.Element;
}

/**
 * Confirmed bulk delete for the checkbox selection of a `SearchControl` table.
 * The toolbar's built-in "Delete…" button calls straight into `onDelete` with no
 * confirmation of its own, so this hook interposes a dialog, deletes each
 * selected resource (continuing past per-item failures, e.g. ones the user's
 * access policy forbids), reports the outcome, and triggers a refresh.
 *
 * @param resourceType - The resource type listed in the table.
 * @param onDeleted - Called after the attempt so the caller can refresh the table.
 * @returns The delete request handler and the dialog element.
 */
export function useBulkDelete(resourceType: ResourceType | undefined, onDeleted: () => void): BulkDelete {
  const medplum = useMedplum();
  const [pendingIds, setPendingIds] = useState<string[]>();
  const [busy, setBusy] = useState(false);

  const requestDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) {
      showNotification({ color: 'yellow', message: 'Select one or more rows first (use the checkboxes).' });
      return;
    }
    setPendingIds(ids);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingIds || !resourceType) {
      return;
    }
    setBusy(true);
    let deleted = 0;
    const failures: string[] = [];
    for (const id of pendingIds) {
      try {
        await medplum.deleteResource(resourceType, id);
        deleted++;
      } catch (err) {
        failures.push(normalizeErrorString(err));
      }
    }
    setBusy(false);
    setPendingIds(undefined);
    if (failures.length === 0) {
      showNotification({ color: 'green', message: `Deleted ${deleted} ${resourceType} record(s)` });
    } else {
      showNotification({
        color: deleted > 0 ? 'yellow' : 'red',
        title: `Deleted ${deleted}, failed ${failures.length}`,
        message: failures[0],
        autoClose: false,
      });
    }
    medplum.invalidateSearches(resourceType);
    onDeleted();
  }, [medplum, resourceType, pendingIds, onDeleted]);

  const confirmElement = (
    <Modal
      opened={pendingIds !== undefined}
      onClose={() => setPendingIds(undefined)}
      title={`Delete ${pendingIds?.length ?? 0} ${resourceType} record(s)?`}
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          This permanently removes the selected record(s) from the active chart. Historical versions remain in the audit
          trail.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setPendingIds(undefined)} disabled={busy}>
            Cancel
          </Button>
          <Button color="red" onClick={handleConfirm} loading={busy}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return { requestDelete, confirmElement };
}
