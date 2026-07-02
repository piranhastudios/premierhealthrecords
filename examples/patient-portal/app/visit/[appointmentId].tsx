import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors } from '../../src/theme/tokens';

/**
 * Telehealth call surface. The peer connection uses react-native-webrtc (a locked
 * project decision) with FHIR-based signaling; that wiring requires a dev build and
 * a signaling channel, so this screen ships the call UI + lifecycle and marks the
 * media hookup as the remaining integration step.
 */
export default function VideoVisit(): JSX.Element {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  return (
    <View className="flex-1 bg-[#201a17]">
      {/* Remote video placeholder */}
      <View className="flex-1 items-center justify-center">
        <View className="w-24 h-24 rounded-full bg-white/10 items-center justify-center mb-4">
          <Ionicons name="videocam" size={40} color="white" />
        </View>
        <Text className="text-white text-lg font-semibold">Connecting to your doctor…</Text>
        <Text className="text-white/50 text-xs mt-1">Visit {String(appointmentId).slice(0, 8)}</Text>
      </View>

      {/* Self preview */}
      <View className="absolute top-16 right-5 w-24 h-32 rounded-2xl bg-white/15 items-center justify-center">
        <Ionicons name={cameraOff ? 'videocam-off' : 'person'} size={28} color="white" />
      </View>

      {/* Controls */}
      <View className="flex-row items-center justify-center gap-5 pb-12 pt-6">
        <ControlButton icon={muted ? 'mic-off' : 'mic'} onPress={() => setMuted((v) => !v)} />
        <ControlButton icon={cameraOff ? 'videocam-off' : 'videocam'} onPress={() => setCameraOff((v) => !v)} />
        <Pressable onPress={() => router.back()} className="w-16 h-16 rounded-full bg-status-error items-center justify-center">
          <Ionicons name="call" size={26} color={colors.white} style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
      </View>
    </View>
  );
}

function ControlButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }): JSX.Element {
  return (
    <Pressable onPress={onPress} className="w-14 h-14 rounded-full bg-white/15 items-center justify-center">
      <Ionicons name={icon} size={24} color="white" />
    </Pressable>
  );
}
