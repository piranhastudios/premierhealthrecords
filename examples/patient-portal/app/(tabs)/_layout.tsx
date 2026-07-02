import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { OfflineBanner } from '../../src/components/OfflineBanner';
import { colors } from '../../src/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;
}

export default function TabsLayout(): JSX.Element {
  return (
    <>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.orange,
          tabBarInactiveTintColor: colors.inkFaint,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line, height: 60, paddingBottom: 8, paddingTop: 6 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="appointments" options={{ title: 'Appointments', tabBarIcon: tabIcon('calendar') }} />
        <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: tabIcon('chatbubble-ellipses') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person') }} />
      </Tabs>
    </>
  );
}
