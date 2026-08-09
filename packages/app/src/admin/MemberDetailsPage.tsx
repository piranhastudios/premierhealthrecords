// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Group, Text, Title } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { Patient, Practitioner, ProjectMembership, Reference, User } from '@medplum/fhirtypes';
import { getRecaptcha, initRecaptcha, Loading, MedplumLink, ResourceTable, useMedplum, useResource } from '@medplum/react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { getConfig } from '../config';

/**
 * Best-effort email for a project member: the profile's email telecom, falling
 * back to the membership's user display when it looks like an email.
 * @param membership - The project membership.
 * @param profile - The member's profile resource.
 * @returns The member's email, or undefined.
 */
function memberEmail(membership: ProjectMembership, profile: Patient | Practitioner): string | undefined {
  const telecom = profile.telecom?.find((t) => t.system === 'email')?.value;
  if (telecom) {
    return telecom;
  }
  const display = membership.user?.display;
  return display?.includes('@') ? display : undefined;
}

export function MemberDetailsPage(): JSX.Element {
  const medplum = useMedplum();
  const { membershipId } = useParams() as { membershipId: string };
  const membership = medplum.readResource('ProjectMembership', membershipId).read();
  const profile = useResource(membership.profile);
  const [sending, setSending] = useState(false);
  const recaptchaSiteKey = getConfig().recaptchaSiteKey;

  // The server requires a recaptcha token on /auth/resetpassword whenever a
  // recaptcha secret is configured, so load the widget up front.
  useEffect(() => {
    if (recaptchaSiteKey) {
      initRecaptcha(recaptchaSiteKey);
    }
  }, [recaptchaSiteKey]);

  if (!profile) {
    return <Loading />;
  }

  const email = memberEmail(membership, profile as Patient | Practitioner);

  const sendPasswordReset = async (): Promise<void> => {
    setSending(true);
    try {
      // Project-scoped users (patients, and practitioners invited with project
      // scope) are only found when the request carries their projectId; global
      // users only when it doesn't. Read the User to check its scoping — the
      // wrong variant silently matches nobody (anti-enumeration) and no email
      // goes out. If the User isn't readable (global users, for non-super
      // admins), fall back to profile-type heuristics.
      const projectId = membership.project?.reference?.split('/')[1];
      let projectScoped = profile.resourceType === 'Patient';
      if (membership.user?.reference?.startsWith('User/')) {
        try {
          const user = await medplum.readReference(membership.user as Reference<User>);
          projectScoped = Boolean(user.project);
        } catch {
          // Fall back to the heuristic.
        }
      }
      const recaptchaToken = recaptchaSiteKey ? await getRecaptcha(recaptchaSiteKey) : undefined;
      await medplum.post('auth/resetpassword', {
        email,
        ...(recaptchaToken ? { recaptchaToken } : {}),
        ...(projectScoped && projectId ? { projectId } : {}),
      });
      showNotification({ color: 'green', message: `Password reset email sent to ${email}` });
    } catch (err) {
      showNotification({ color: 'red', message: normalizeErrorString(err), autoClose: false });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Title>ProjectMembership Details</Title>
      <MedplumLink to={membership}>Go to ProjectMembership</MedplumLink>
      <ResourceTable value={membership} />
      <Title mt="md" order={3}>
        Security
      </Title>
      <Group mt="xs" gap="sm">
        <Button onClick={sendPasswordReset} loading={sending} disabled={!email}>
          Send password reset email
        </Button>
        {email ? (
          <Text c="dimmed" size="sm">
            Emails a set-password link to {email}
          </Text>
        ) : (
          <Text c="dimmed" size="sm">
            No email found on this member's profile
          </Text>
        )}
      </Group>
      <Title mt="md">Profile Details</Title>
      <MedplumLink to={profile}>Go to {profile.resourceType}</MedplumLink>
      <ResourceTable value={profile} ignoreMissingValues />
    </>
  );
}
