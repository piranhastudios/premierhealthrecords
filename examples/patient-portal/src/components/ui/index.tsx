import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';

export { Avatar } from './Avatar';
export { Badge, statusTone } from './Badge';
export { Button } from './Button';
export { Card } from './Card';
export { GradientHeader } from './GradientHeader';
export { Screen } from './Screen';

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <View className="flex-row items-center justify-between mb-1 mt-2">
      <Text className="text-ink text-lg font-bold">{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): JSX.Element {
  return (
    <View className="items-center justify-center py-10">
      <Text className="text-ink-secondary text-base font-medium">{title}</Text>
      {hint ? <Text className="text-ink-faint text-sm mt-1 text-center">{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }): JSX.Element {
  return (
    <View className="items-center justify-center py-12">
      <ActivityIndicator color={colors.orange} />
      {label ? <Text className="text-ink-secondary text-sm mt-3">{label}</Text> : null}
    </View>
  );
}

export function Row({ left, right }: { left: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <View className="flex-row items-center justify-between py-1">
      <View className="flex-1 pr-3">{left}</View>
      {right}
    </View>
  );
}
