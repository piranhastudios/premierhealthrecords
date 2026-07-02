// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Alert } from '@mantine/core';
import type { InternalTypeSchema } from '@medplum/core';
import { addProfileToResource, normalizeErrorString, tryGetProfile } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';
import type { ResourceFormProps } from '@medplum/react';
import { Loading, ResourceForm, useMedplum } from '@medplum/react';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { JSX, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

interface ResourceFormWithRequiredProfileProps extends ResourceFormProps {
  /** (optional) URL of the profile that customizes the form. */
  readonly profileUrl?: string; // Also part of ResourceFormProps, but list here incase its type changes in the future
  /** (optional) A short message shown when `profileUrl` cannot be loaded and the base form is used instead. */
  readonly missingProfileMessage?: ReactNode;
}

/**
 * Renders a {@link ResourceForm} driven by a profile when that profile is available.
 *
 * If the profile cannot be loaded (e.g. the StructureDefinition has not been uploaded
 * to this project yet), the form falls back to the base resource schema rather than
 * blocking — a not-yet-installed profile must never prevent creating/editing the
 * resource. A non-blocking notice is shown so the missing customization is visible
 * rather than a silent no-op.
 * @param props - The resource form props plus the profile URL and missing-profile message.
 * @returns The profile-driven form, or the base form with a notice when the profile is unavailable.
 */
export function ResourceFormWithRequiredProfile(props: ResourceFormWithRequiredProfileProps): JSX.Element {
  const { missingProfileMessage, onSubmit, ...resourceFormProps } = props;
  const profileUrl = props.profileUrl;

  const medplum = useMedplum();
  const [loadingProfile, setLoadingProfile] = useState(Boolean(profileUrl));
  const [profileError, setProfileError] = useState<any>();
  const [profile, setProfile] = useState<InternalTypeSchema>();

  useEffect(() => {
    if (!profileUrl) {
      // loadingProfile already initializes to false when there is no profile.
      return;
    }

    setLoadingProfile(true);
    setProfile(undefined);
    setProfileError(undefined);

    medplum
      .requestProfileSchema(profileUrl, { expandProfile: true })
      .then(() => {
        const resourceProfile = tryGetProfile(profileUrl);
        if (resourceProfile) {
          setProfile(resourceProfile);
        }
      })
      .catch((reason) => {
        console.error(reason);
        setProfileError(reason);
      })
      .finally(() => setLoadingProfile(false));
  }, [medplum, profileUrl]);

  const profileLoaded = Boolean(profileUrl && profile);

  const handleSubmit = useCallback(
    (newResource: Resource): void => {
      if (!onSubmit) {
        return;
      }
      // Only stamp meta.profile when the profile actually loaded; otherwise the
      // resource is being edited against the base schema.
      if (profileLoaded && profileUrl) {
        addProfileToResource(newResource, profileUrl);
      }
      onSubmit(newResource);
    },
    [onSubmit, profileLoaded, profileUrl]
  );

  if (profileUrl && loadingProfile) {
    return <Loading />;
  }

  const profileMissing = Boolean(profileUrl) && !profileLoaded;

  return (
    <>
      {profileMissing && (
        <Alert icon={<IconAlertTriangle size={16} />} title="Using the standard form" color="yellow" mb="md">
          {missingProfileMessage ?? 'The customized form for this project is not installed, so the standard form is shown.'}
          {profileError && <div>Server error: {normalizeErrorString(profileError)}</div>}
        </Alert>
      )}
      <ResourceForm onSubmit={handleSubmit} {...resourceFormProps} profileUrl={profileMissing ? undefined : profileUrl} />
    </>
  );
}
