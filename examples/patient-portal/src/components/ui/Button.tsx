import { ActivityIndicator, Pressable, Text } from 'react-native';
import { colors } from '../../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

const containerByVariant: Record<Variant, string> = {
  primary: 'bg-phc-orange',
  secondary: 'bg-surface-muted',
  ghost: 'bg-transparent',
  danger: 'bg-status-error',
};

const textByVariant: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-ink',
  ghost: 'text-phc-orange',
  danger: 'text-white',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      className={`h-12 rounded-pill items-center justify-center px-5 ${containerByVariant[variant]} ${
        isDisabled ? 'opacity-50' : ''
      } ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.white : colors.orange} />
      ) : (
        <Text className={`text-base font-semibold ${textByVariant[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
