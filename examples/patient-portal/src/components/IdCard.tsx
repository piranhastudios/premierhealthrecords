import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import type { Patient } from '@medplum/fhirtypes';
import { patientCni, patientMrn, patientName } from '../lib/format';
import { requireBiometric } from '../qr/biometricGate';
import { useRotatingQr } from '../qr/useRotatingQr';
import { QR_INTENTS, type QrIntent } from '../qr/types';
import { cardGradient, colors } from '../theme/tokens';
import { QrBadge } from './QrBadge';

const CARD_HEIGHT = 232;
const INTENT_ORDER: QrIntent[] = ['id', 'checkin', 'pay', 'grant'];

interface IdCardProps {
  patient: Patient;
  /** Optional context (e.g. an invoice id) for the pay intent. */
  context?: string;
  initialIntent?: QrIntent;
}

export function IdCard({ patient, context, initialIntent = 'id' }: IdCardProps): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const [intent, setIntent] = useState<QrIntent>(initialIntent);
  const spin = useRef(new Animated.Value(0)).current;

  const qr = useRotatingQr(revealed ? patient.id : undefined, intent, context);

  const frontRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const faceBase = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backfaceVisibility: 'hidden' } as const;

  async function toggle(): Promise<void> {
    if (!revealed) {
      const ok = await requireBiometric('Reveal your Premier Health ID code');
      if (!ok) {
        return;
      }
      setRevealed(true);
      Animated.timing(spin, { toValue: 1, duration: 520, useNativeDriver: true }).start();
    } else {
      Animated.timing(spin, { toValue: 0, duration: 520, useNativeDriver: true }).start(() => setRevealed(false));
    }
  }

  return (
    <View style={{ height: CARD_HEIGHT }}>
      {/* FRONT */}
      <Animated.View style={[faceBase, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}>
        <Pressable onPress={toggle} className="flex-1">
          <LinearGradient
            colors={cardGradient.colors as readonly [string, string, ...string[]]}
            start={cardGradient.start}
            end={cardGradient.end}
            className="flex-1 rounded-card p-5 justify-between"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-lg font-extrabold">Premier Health</Text>
              <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center">
                <Text className="text-white text-xl font-black">P</Text>
              </View>
            </View>
            <View>
              <Text className="text-white/70 text-xs">Member</Text>
              <Text className="text-white text-2xl font-bold">{patientName(patient)}</Text>
            </View>
            <View className="flex-row justify-between items-end">
              <View>
                <Text className="text-white/70 text-[11px]">CNI</Text>
                <Text className="text-white text-sm font-semibold">{patientCni(patient) ?? '—'}</Text>
              </View>
              <View>
                <Text className="text-white/70 text-[11px]">MRN</Text>
                <Text className="text-white text-sm font-semibold">{patientMrn(patient) ?? '—'}</Text>
              </View>
              <Text className="text-white/90 text-xs font-semibold">Tap to reveal code →</Text>
            </View>
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* BACK */}
      <Animated.View style={[faceBase, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}>
        <Pressable onPress={toggle} className="flex-1 bg-surface-card rounded-card p-4 flex-row">
          <View className="items-center justify-center pr-3">
            <QrBadge value={qr.payload?.value} size={150} loading={qr.loading} error={qr.error} />
          </View>
          <View className="flex-1 justify-center">
            <Text className="text-ink font-bold mb-1">{QR_INTENTS[intent].label}</Text>
            <Text className="text-ink-secondary text-xs mb-2">{QR_INTENTS[intent].description}</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {INTENT_ORDER.map((i) => {
                const selected = i === intent;
                return (
                  <Pressable
                    key={i}
                    onPress={() => setIntent(i)}
                    className={`px-2.5 py-1 rounded-pill ${selected ? 'bg-phc-orange' : 'bg-surface-muted'}`}
                  >
                    <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-ink-secondary'}`}>
                      {QR_INTENTS[i].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="text-ink-faint text-[11px] mt-2">
              Rotates every 30s · {qr.online ? 'verified online' : 'offline code'}
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* spacer to give the absolute children a measured box */}
      <View style={{ height: CARD_HEIGHT }} pointerEvents="none" />
      {revealed ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -18, left: 0, right: 0 }}>
          <Text className="text-ink-faint text-[11px] text-center" style={{ color: colors.inkFaint }}>
            Tap card to hide
          </Text>
        </View>
      ) : null}
    </View>
  );
}
