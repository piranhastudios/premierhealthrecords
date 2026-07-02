import { getReferenceString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const ACTIVE_KEY = 'phc.activeProfileId';

export interface ProfileContextValue {
  loading: boolean;
  /** The signed-in patient (account holder). */
  holder?: Patient;
  /** Holder + managed dependents. */
  profiles: Patient[];
  /** The patient currently being viewed/acted on. */
  activePatient?: Patient;
  setActivePatientId: (id: string) => void;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

/**
 * Resolves the account holder + the dependents they manage. Dependents are
 * discovered from `Patient.link` on the holder (other → Patient). The "active"
 * profile is what every screen scopes its FHIR queries to (by patient id).
 */
export function ActiveProfileProvider({ children }: { children: ReactNode }): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [profiles, setProfiles] = useState<Patient[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const holder = profile?.resourceType === 'Patient' ? (profile as Patient) : undefined;

  const refresh = useCallback(async () => {
    if (!holder?.id) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const dependents: Patient[] = [];
      const links = (holder.link ?? []).filter((l) => l.other?.reference?.startsWith('Patient/'));
      for (const link of links) {
        try {
          const dep = await medplum.readReference(link.other);
          if (dep.resourceType === 'Patient' && dep.id !== holder.id) {
            dependents.push(dep);
          }
        } catch {
          // Skip unreadable links (e.g. an adult who has claimed their own login).
        }
      }
      setProfiles([holder, ...dependents]);
    } finally {
      setLoading(false);
    }
  }, [holder, medplum]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Restore the last-selected profile.
  useEffect(() => {
    SecureStore.getItemAsync(ACTIVE_KEY)
      .then((stored) => {
        if (stored) {
          setActiveId(stored);
        }
      })
      .catch(() => undefined);
  }, []);

  const setActivePatientId = useCallback((id: string) => {
    setActiveId(id);
    void SecureStore.setItemAsync(ACTIVE_KEY, id).catch(() => undefined);
  }, []);

  const activePatient = useMemo(() => {
    return profiles.find((p) => p.id === activeId) ?? profiles[0];
  }, [profiles, activeId]);

  const value = useMemo<ProfileContextValue>(
    () => ({ loading, holder, profiles, activePatient, setActivePatientId, refresh }),
    [loading, holder, profiles, activePatient, setActivePatientId, refresh]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useActiveProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useActiveProfile must be used within ActiveProfileProvider');
  }
  return ctx;
}

/** Convenience: a FHIR search param value for the active patient, e.g. "Patient/123". */
export function useActivePatientRef(): string | undefined {
  const { activePatient } = useActiveProfile();
  return activePatient ? getReferenceString(activePatient) : undefined;
}
