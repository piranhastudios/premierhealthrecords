import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner(): JSX.Element | null {
  const { online } = useNetworkStatus();
  // Rendered above the tab navigator, so when it is visible it is the topmost
  // element on screen and must clear the status bar itself.
  const insets = useSafeAreaInsets();
  if (online) {
    return null;
  }
  return (
    <View style={{ paddingTop: insets.top }} className="bg-phc-ember px-5 py-2">
      <Text className="text-white text-xs font-semibold text-center">
        Offline — showing your saved records. Changes will sync when you reconnect.
      </Text>
    </View>
  );
}
