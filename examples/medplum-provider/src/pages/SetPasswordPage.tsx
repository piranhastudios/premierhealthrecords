// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Card, Center, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import { Logo, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

/**
 * Landing page for the set-password links emailed by the server (staff invites
 * and password resets both point at `{appBaseUrl}setpassword/{id}/{secret}`,
 * and the provider app is the appBaseUrl). Rendered standalone — no app chrome.
 * Own form rather than the `@medplum/react` SetPasswordForm so the card sizes
 * and styles match the sign-in page.
 *
 * @returns The set password page.
 */
export function SetPasswordPage(): JSX.Element {
  const { id, secret } = useParams() as { id: string; secret: string };
  const medplum = useMedplum();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await medplum.post('auth/setpassword', { id, secret, password });
      setSuccess(true);
    } catch (err) {
      setError(normalizeErrorString(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Card withBorder shadow="md" radius="lg" p="xl" w="100%" maw={460}>
        <Stack gap="md">
          <Stack gap={4} align="center">
            <Logo size={40} />
            <Title order={2} mt="sm">
              Set your password
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              Choose a password for your Premier Health account.
            </Text>
          </Stack>

          {success ? (
            <Stack gap="md" align="center">
              <Alert color="green" icon={<IconCircleCheck size={18} />} w="100%">
                Your password has been set.
              </Alert>
              <Button component={Link} to="/signin" color="brand" fullWidth>
                Sign in
              </Button>
            </Stack>
          ) : (
            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                {error && (
                  <Alert color="red" icon={<IconInfoCircle size={18} />}>
                    {error}
                  </Alert>
                )}
                <PasswordInput
                  label="New password"
                  size="md"
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Confirm new password"
                  size="md"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.currentTarget.value)}
                />
                <Button type="submit" color="brand" size="md" fullWidth loading={saving} mt="xs">
                  Set password
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
