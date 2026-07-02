import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/** Reactive online/offline status. Drives the offline banner + the sync drain loop. */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  return { online };
}
