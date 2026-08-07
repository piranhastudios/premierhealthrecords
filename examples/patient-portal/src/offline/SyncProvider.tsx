import { useMedplum } from '@medplum/react-hooks';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useActiveProfile } from '../hooks/useActiveProfile';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { drainOutbox, syncAll } from './sync';

export interface SyncContextValue {
  syncing: boolean;
  lastSyncedAt?: number;
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

/** Auto-syncs the curated cache when online + profiles are known, and drains the
 *  offline write queue on reconnect. Exposes refresh() for pull-to-refresh. */
export function SyncProvider({ children }: { children: ReactNode }): JSX.Element {
  const medplum = useMedplum();
  const { online } = useNetworkStatus();
  const { holder, profiles } = useActiveProfile();
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>();
  const wasOffline = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!online || profiles.length === 0) {
      return;
    }
    // Coalesce concurrent triggers (initial effect, profile change, reconnect)
    // into a single run — overlapping syncs would race on the shared DB.
    if (inFlight.current) {
      return inFlight.current;
    }
    const task = (async () => {
      setSyncing(true);
      try {
        await drainOutbox(medplum);
        await syncAll(medplum, holder?.id, profiles);
        setLastSyncedAt(Date.now());
      } finally {
        setSyncing(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }, [medplum, online, holder?.id, profiles]);

  // Initial + profile-change sync.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Drain queue immediately on reconnect.
  useEffect(() => {
    if (online && wasOffline.current) {
      void refresh();
    }
    wasOffline.current = !online;
  }, [online, refresh]);

  return <SyncContext.Provider value={{ syncing, lastSyncedAt, refresh }}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSync must be used within SyncProvider');
  }
  return ctx;
}
