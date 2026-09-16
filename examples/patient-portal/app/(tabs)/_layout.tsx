import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { colors } from '../../src/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
}

/** Visible height of the bar itself, before the system gesture area is added. */
const TAB_BAR_HEIGHT = 60;

export default function TabsLayout(): JSX.Element {
  // Android is edge-to-edge from Expo SDK 54 (the config type only accepts
  // `edgeToEdgeEnabled: true`), so the app draws underneath the system bars.
  // The hard-coded 60px tabBar height left no room for the navigation bar,
  // which was drawn straight over the tab labels. This affects 3-button
  // navigation as well as gesture pills — both report a bottom inset under
  // edge-to-edge — so do not assume only gesture devices need it.
  const insets = useSafeAreaInsets();
  return (
    <>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.orange,
          tabBarInactiveTintColor: colors.inkFaint,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.line,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingBottom: 8 + insets.bottom,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="appointments" options={{ title: 'Appointments', tabBarIcon: tabIcon('calendar') }} />
        <Tabs.Screen name="records" options={{ title: 'Records', tabBarIcon: tabIcon('document-text') }} />
        <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: tabIcon('chatbubble-ellipses') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person') }} />
      </Tabs>
    </>
  );
}
