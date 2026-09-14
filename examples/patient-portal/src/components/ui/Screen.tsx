import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '../../theme/tokens';

interface ScreenProps {
  children: ReactNode;
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
 *   - inside `(tabs)`: `edges={[]}` when the screen starts with a full-bleed
 *     header, otherwise the default `['top']`. The bottom is already handled —
 *     the tab bar grows by the bottom inset (see app/(tabs)/_layout.tsx).
 *   - anywhere else: `['top', 'bottom']`, because nothing underneath is
 *     clearing the navigation bar for you.
 */
export function Screen({ children, scroll = true, refreshing, onRefresh, edges = ['top'] }: ScreenProps): JSX.Element {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-surface-bg">
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-12 pt-2 gap-4"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.orange} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View className="flex-1 px-5 pt-2">{children}</View>
      )}
    </SafeAreaView>
  );
}
