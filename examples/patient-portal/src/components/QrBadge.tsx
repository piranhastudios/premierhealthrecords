import QRCode from 'react-native-qrcode-svg';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

interface QrBadgeProps {
  value?: string;
  size?: number;
  loading?: boolean;
  error?: string;
}

export function QrBadge({ value, size = 220, loading, error }: QrBadgeProps): JSX.Element {
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center bg-white rounded-card">
      {loading ? (
        <ActivityIndicator color={colors.orange} />
      ) : error || !value ? (
        <Text className="text-status-error text-center text-sm px-4">{error ?? 'Code unavailable'}</Text>
      ) : (
        <QRCode value={value} size={size - 24} backgroundColor="white" color={colors.ink} />
      )}
    </View>
  );
}
