// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { Logo, SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

// The clinic data project ("FHIR R4" — the fixed id every Medplum server seeds;
// see packages/server/src/constants.ts). Pinning the sign-in to it means users
// with more than one membership (e.g. the admin, who also holds the operator
// console) go straight into the clinic without a project-picker step. Override
// with ?project=<id> or VITE_MEDPLUM_PROJECT_ID when targeting another project.
const CLINIC_PROJECT_ID = '161452d9-43b7-5c29-aa7b-c85680fa45c6';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  return (
    <SignInForm
      // Configure according to your settings
      googleClientId="921088377005-3j1sa10vr6hj86jgmdfh2l53v3mp7lfi.apps.googleusercontent.com"
      onSuccess={() => navigate('/')?.catch(console.error)}
      projectId={searchParams.get('project') || import.meta.env.VITE_MEDPLUM_PROJECT_ID || CLINIC_PROJECT_ID}
      login={searchParams.get('login') || undefined}
    >
      <Logo size={32} />
      <Title order={3} py="lg">
        Sign in to Provider
      </Title>
    </SignInForm>
  );
}
