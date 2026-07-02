import { Text, View } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineBanner(): JSX.Element | null {
  const { online } = useNetworkStatus();
  if (online) {
    return null;
  }
  return (
    <View className="bg-phc-ember px-5 py-2">
      <Text className="text-white text-xs font-semibold text-center">
        Offline — showing your saved records. Changes will sync when you reconnect.
      </Text>
    </View>
  );
}
