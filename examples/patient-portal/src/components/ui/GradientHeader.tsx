import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { heroGradient } from '../../theme/tokens';

interface GradientHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}

/**
 * Warm PHC gradient header (the recurring hero banner from the inspiration).
 *
 * Deliberately does NOT add the top safe-area inset. Every screen using this
 * renders it inside `Screen`, which already applies the top edge, so adding it
 * here too left a band of empty gradient the height of the status bar above the
 * title.
 */
export function GradientHeader({ title, subtitle, right, children }: GradientHeaderProps): JSX.Element {
  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      start={heroGradient.start}
      end={heroGradient.end}
      className="px-5 pt-3 pb-6 rounded-b-[28px]"
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
