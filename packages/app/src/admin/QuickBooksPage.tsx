// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { Parameters, ProjectSetting } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getProjectId } from '../utils';

// Project secrets used by the QuickBooks integration
// (see packages/server/src/accounting/quickbooks.ts).
const CLIENT_ID = 'QUICKBOOKS_CLIENT_ID';
const CLIENT_SECRET = 'QUICKBOOKS_CLIENT_SECRET';
const BASE_URL = 'QUICKBOOKS_BASE_URL';
const REALM_ID = 'QUICKBOOKS_REALM_ID';
const REFRESH_TOKEN = 'QUICKBOOKS_REFRESH_TOKEN';
const ACCESS_TOKEN = 'QUICKBOOKS_ACCESS_TOKEN';
const ACCESS_TOKEN_EXPIRES_AT = 'QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT';

// The server defaults to the sandbox (QBO_SANDBOX_URL in
// packages/server/src/accounting/quickbooks.ts) when QUICKBOOKS_BASE_URL is
// unset, so only the production URL is ever written as a secret.
const PRODUCTION_URL = 'https://quickbooks.api.intuit.com';

function getSecret(secrets: ProjectSetting[], name: string): string | undefined {
  return secrets.find((s) => s.name === name)?.valueString;
}

/**
 * Merges named values into a project secret array, dropping entries whose new
 * value is undefined and preserving all unrelated secrets.
 * @param secrets - The current secret array.
 * @param updates - Secret names mapped to their new values (undefined removes).
 * @returns The merged secret array.
 */
function mergeSecrets(secrets: ProjectSetting[], updates: Record<string, string | undefined>): ProjectSetting[] {
  const result = secrets.filter((s) => !(s.name && s.name in updates));
  for (const [name, value] of Object.entries(updates)) {
    if (value) {
      result.push({ name, valueString: value });
    }
  }
  return result;
}

/**
 * QuickBooks Online connection management for the current project: app
 * credentials, the OAuth connect flow, the service-pricing pull, and disconnect.
 * Invoice/payment pushes themselves run automatically through the
 * `premierhealth-quickbooks-*` bot Subscriptions once connected.
 *
 * @returns The QuickBooks admin page.
 */
export function QuickBooksPage(): JSX.Element {
  const medplum = useMedplum();
  const projectId = getProjectId(medplum);

  const [secrets, setSecrets] = useState<ProjectSetting[]>();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState<string>('sandbox');
  const [busy, setBusy] = useState<string>();

  const loadSecrets = useCallback(async () => {
    const details = await medplum.get(`admin/projects/${projectId}`, { cache: 'reload' });
    const loaded = (details.project.secret ?? []) as ProjectSetting[];
    setSecrets(loaded);
    setClientId(getSecret(loaded, CLIENT_ID) ?? '');
    setClientSecret(getSecret(loaded, CLIENT_SECRET) ?? '');
    setEnvironment(getSecret(loaded, BASE_URL) === PRODUCTION_URL ? 'production' : 'sandbox');
  }, [medplum, projectId]);

  useEffect(() => {
    loadSecrets().catch(console.error);
  }, [loadSecrets]);

  if (!secrets) {
    return <div>Loading...</div>;
  }

  const configured = Boolean(getSecret(secrets, CLIENT_ID) && getSecret(secrets, CLIENT_SECRET));
  const realmId = getSecret(secrets, REALM_ID);
  const connected = Boolean(realmId && getSecret(secrets, REFRESH_TOKEN));
  const callbackUrl = new URL('accounting/quickbooks/callback', medplum.getBaseUrl()).toString();

  async function saveSecrets(updates: Record<string, string | undefined>, message: string): Promise<void> {
    await medplum.post(`admin/projects/${projectId}/secrets`, mergeSecrets(secrets ?? [], updates));
    await loadSecrets();
    showNotification({ color: 'green', message });
  }

  async function handleSaveCredentials(): Promise<void> {
    setBusy('save');
    try {
      await saveSecrets(
        {
          [CLIENT_ID]: clientId.trim() || undefined,
          [CLIENT_SECRET]: clientSecret.trim() || undefined,
          [BASE_URL]: environment === 'production' ? PRODUCTION_URL : undefined,
        },
        'QuickBooks credentials saved'
      );
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setBusy(undefined);
    }
  }

  async function handleConnect(): Promise<void> {
    setBusy('connect');
    try {
      const { authorizeUrl } = await medplum.get('accounting/quickbooks/connect', { cache: 'no-cache' });
      // Intuit completes the flow in this tab/window; the server callback page
      // confirms and the operator returns here and refreshes the status.
      window.open(authorizeUrl, '_blank', 'noopener');
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setBusy(undefined);
    }
  }

  async function handlePullPricing(): Promise<void> {
    setBusy('pricing');
    try {
      const result = (await medplum.post(medplum.fhirUrl('$qbo-pull-pricing'), {
        resourceType: 'Parameters',
        parameter: [],
      })) as Parameters;
      const count = (name: string): number =>
        (result.parameter?.find((p) => p.name === name)?.valueInteger as number) ?? 0;
      showNotification({
        color: 'green',
        title: 'Pricing pulled from QuickBooks',
        message: `${count('total')} item(s): ${count('created')} created, ${count('updated')} updated.`,
      });
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setBusy(undefined);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setBusy('disconnect');
    try {
      await saveSecrets(
        {
          [REALM_ID]: undefined,
          [REFRESH_TOKEN]: undefined,
          [ACCESS_TOKEN]: undefined,
          [ACCESS_TOKEN_EXPIRES_AT]: undefined,
        },
        'QuickBooks disconnected'
      );
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Stack gap="lg" maw={640}>
      <div>
        <Group justify="space-between" align="center">
          <Title>QuickBooks</Title>
          {connected ? (
            <Badge color="green" size="lg" data-testid="qbo-status">
              Connected · company {realmId}
            </Badge>
          ) : (
            <Badge color="gray" size="lg" data-testid="qbo-status">
              {configured ? 'Not connected' : 'Not configured'}
            </Badge>
          )}
        </Group>
        <Text c="dimmed" size="sm" mt={4}>
          Balanced invoices and settled payments are pushed to QuickBooks automatically once connected; service pricing
          is pulled from the QuickBooks item list.
        </Text>
      </div>

      <div>
        <Title order={4}>1. Intuit app credentials</Title>
        <Text c="dimmed" size="sm" mb="sm">
          From your app on the Intuit developer portal. Register this exact redirect URI there:{' '}
          <Code>{callbackUrl}</Code>
        </Text>
        <Stack gap="sm">
          <TextInput
            label="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
            autoComplete="off"
          />
          <PasswordInput
            label="Client secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
            autoComplete="off"
          />
          <Select
            label="Environment"
            data={[
              { value: 'sandbox', label: 'Sandbox (test company)' },
              { value: 'production', label: 'Production' },
            ]}
            value={environment}
            onChange={(v) => setEnvironment(v ?? 'sandbox')}
            allowDeselect={false}
          />
          <Group>
            <Button onClick={handleSaveCredentials} loading={busy === 'save'}>
              Save credentials
            </Button>
          </Group>
        </Stack>
      </div>

      <Divider />

      <div>
        <Title order={4}>2. Connect the company</Title>
        <Text c="dimmed" size="sm" mb="sm">
          Opens Intuit sign-in in a new tab. After approving, return here — the status refreshes on reload.
        </Text>
        <Group>
          <Button onClick={handleConnect} loading={busy === 'connect'} disabled={!configured}>
            {connected ? 'Reconnect' : 'Connect to QuickBooks'}
          </Button>
          <Button variant="default" onClick={() => loadSecrets().catch(console.error)}>
            Refresh status
          </Button>
          {connected && (
            <Button color="red" variant="light" onClick={handleDisconnect} loading={busy === 'disconnect'}>
              Disconnect
            </Button>
          )}
        </Group>
      </div>

      <Divider />

      <div>
        <Title order={4}>3. Service pricing</Title>
        <Text c="dimmed" size="sm" mb="sm">
          Imports the QuickBooks item list as the service price catalog (ChargeItemDefinitions). Run after connecting,
          and again whenever prices change in QuickBooks.
        </Text>
        <Button onClick={handlePullPricing} loading={busy === 'pricing'} disabled={!connected}>
          Pull pricing now
        </Button>
      </div>

      {!connected && configured && (
        <Alert color="yellow" variant="light">
          Credentials are saved but no company is connected yet — invoice and payment pushes stay inactive until the
          connect flow completes.
        </Alert>
      )}
    </Stack>
  );
}
