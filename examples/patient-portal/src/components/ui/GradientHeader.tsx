import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { heroGradient } from '../../theme/tokens';

interface GradientHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}

/** Warm PHC gradient header (the recurring hero banner from the inspiration). */
export function GradientHeader({ title, subtitle, right, children }: GradientHeaderProps): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      start={heroGradient.start}
      end={heroGradient.end}
      style={{ paddingTop: insets.top + 12 }}
      className="px-5 pb-6 rounded-b-[28px]"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          {subtitle ? <Text className="text-white/80 text-sm mb-1">{subtitle}</Text> : null}
          <Text className="text-white text-2xl font-bold">{title}</Text>
        </View>
        {right}
      </View>
      {children ? <View className="mt-4">{children}</View> : null}
    </LinearGradient>
  );
}
