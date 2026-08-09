// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { Logo, SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

// The sign-in is NOT pinned to a project by default: the platform hosts one
// project per clinic (FHIR R4, Douala, …), and pinning would lock out staff of
// every other clinic (the server filters login memberships to the pinned
// project). Users with one membership go straight in; users with several get a
// project picker. Pin with ?project=<id> (per-clinic links) or
// VITE_MEDPLUM_PROJECT_ID (single-clinic deployments) when needed.

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return (
    <SignInForm
      // Configure according to your settings
      googleClientId="921088377005-3j1sa10vr6hj86jgmdfh2l53v3mp7lfi.apps.googleusercontent.com"
      onSuccess={() => navigate('/')?.catch(console.error)}
      projectId={searchParams.get('project') || import.meta.env.VITE_MEDPLUM_PROJECT_ID || undefined}
      login={searchParams.get('login') || undefined}
    >
      <Logo size={32} />
      <Title order={3} py="lg">
        Sign in to Provider
      </Title>
    </SignInForm>
  );
}
