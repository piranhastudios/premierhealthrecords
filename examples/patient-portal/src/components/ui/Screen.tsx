import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '../../theme/tokens';

interface ScreenProps {
  children: ReactNode;
  /**
   * Full-bleed banner (a `GradientHeader safeTop`) rendered above the padded
   * content, outside the horizontal padding. Providing it drops the top edge
   * so the banner draws under the status bar; the banner must pad the top
   * inset itself.
   */
  hero?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
}

/**
 * Standard screen frame.
 *
 * Android is edge-to-edge from Expo SDK 54, so every screen draws under the
 * system bars. Which edges to pass:
 *   - inside `(tabs)`: nothing — the default is `['top']`, or `[]` when a
 *     `hero` is given. The bottom is already handled — the tab bar grows by
 *     the bottom inset (see app/(tabs)/_layout.tsx).
 *   - anywhere else: `['top', 'bottom']`, because nothing underneath is
 *     clearing the navigation bar for you.
 */
export function Screen({ children, hero, scroll = true, refreshing, onRefresh, edges }: ScreenProps): JSX.Element {
  return (
    <SafeAreaView edges={edges ?? (hero ? [] : ['top'])} className="flex-1 bg-surface-bg">
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={hero ? 'pb-12' : 'px-5 pb-12 pt-2 gap-4'}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.orange} />
            ) : undefined
          }
        >
          {hero}
          {/* pt-4 keeps the hero-to-content spacing equal to the gap-4 rhythm. */}
          {hero ? <View className="px-5 pt-4 gap-4">{children}</View> : children}
        </ScrollView>
      ) : (
        <View className="flex-1">
          {hero}
          <View className="flex-1 px-5 pt-2">{children}</View>
        </View>
      )}
    </SafeAreaView>
  );
}
