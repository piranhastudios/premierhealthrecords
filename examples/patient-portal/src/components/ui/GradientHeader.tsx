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
  /** Pad the top safe-area inset so the gradient fills the status bar area. */
  safeTop?: boolean;
}

/**
 * Warm PHC gradient header (the recurring hero banner from the inspiration).
 *
 * Two placements, and the inset must be applied exactly once:
 *   - as `Screen`'s `hero` (full-bleed, `Screen` drops its top edge): pass
 *     `safeTop` so the gradient extends under the status bar.
 *   - inside `Screen`'s padded content (top edge applied by `Screen`): omit
 *     `safeTop`, or the status-bar height appears twice above the title.
 */
export function GradientHeader({ title, subtitle, right, children, safeTop = false }: GradientHeaderProps): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={heroGradient.colors as readonly [string, string, ...string[]]}
      start={heroGradient.start}
      end={heroGradient.end}
      className="px-5 pt-3 pb-6 rounded-b-[28px]"
      // Inline style wins over className, replacing pt-3 (12px) when full-bleed.
      style={safeTop ? { paddingTop: insets.top + 12 } : undefined}
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
