// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Encounter, Reference } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useState } from 'react';
import { Outlet, useParams, useSearchParams } from 'react-router';
import { CollectPaymentModal } from '../../components/billing/CollectPaymentModal';
import { EncounterChart } from '../../components/encounter/EncounterChart';
import { usePatient } from '../../hooks/usePatient';
import { showErrorNotification } from '../../utils/notifications';

export const EncounterChartPage = (): JSX.Element | null => {
  const { encounterId } = useParams();
  const patient = usePatient({ ignoreMissingPatientId: true });
  const [searchParams, setSearchParams] = useSearchParams();

  // The point-of-service payment step opens when the visit forms navigate here
  // with ?collect=1, and re-opens on return from the Stripe hosted checkout
  // (?payment=success|cancel) so the card flow can confirm itself.
  const [collectOpened, setCollectOpened] = useState<boolean>(
    () => searchParams.get('collect') === '1' || searchParams.has('payment')
  );

  if (!encounterId) {
    showErrorNotification('Encounter ID not found');
    return null;
  }

  const encounterRef: Reference<Encounter> = {
    reference: `Encounter/${encounterId}`,
  };

  const handleCollectClose = (): void => {
    setCollectOpened(false);
    // Drop the trigger param so a refresh doesn't re-open the step.
    // (PaymentCollection clears the Stripe redirect params itself.)
    if (searchParams.has('collect')) {
      const next = new URLSearchParams(searchParams);
      next.delete('collect');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <>
      <EncounterChart encounter={encounterRef} />
      {patient && (
        <CollectPaymentModal
          patient={patient}
          encounter={encounterRef}
          opened={collectOpened}
          onClose={handleCollectClose}
        />
      )}
      <Outlet />
    </>
  );
};
