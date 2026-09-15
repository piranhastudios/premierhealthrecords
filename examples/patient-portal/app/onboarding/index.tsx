import { useMedplum } from '@medplum/react-hooks';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, Screen, SectionTitle } from '../../src/components/ui';
import { useActiveProfile } from '../../src/hooks/useActiveProfile';
import { patientName } from '../../src/lib/format';
import {
  ID_DOCUMENT_TYPES,
  applyOnboarding,
  onboardingStatus,
  patientPhone,
  type IdDocumentKey,
} from '../../src/lib/onboarding';
import { reportError } from '../../src/lib/reporting';
import { queueProfileEdit } from '../../src/offline/sync';
import { colors } from '../../src/theme/tokens';

const GENDERS = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
] as const;

/** Accepts what people actually type; the server wants YYYY-MM-DD. */
function toIsoDate(input: string): string | undefined {
  const trimmed = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  let year: number, month: number, day: number;
  if (iso) {
    [, year, month, day] = [0, Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [, day, month, year] = [0, Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  } else {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date <= new Date();
  return valid ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : undefined;
}

/**
 * Basic profile — date of birth, sex, mobile and an identity document.
 *
 * Demographics only, on purpose: allergies, medications and conditions are
 * taken by a nurse at the intro appointment rather than self-reported, because
 * unverified clinical data in a chart reads as authoritative and is worse than
 * an empty one.
 *
 * Saves through the offline outbox, so this can be completed with no signal.
 */
export default function Onboarding(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { holder, refresh } = useActiveProfile();

  const [birthDate, setBirthDate] = useState(holder?.birthDate ?? '');
  const [gender, setGender] = useState<string | undefined>(holder?.gender);
  const [phone, setPhone] = useState(patientPhone(holder) ?? '');
  const [idType, setIdType] = useState<IdDocumentKey>('cni');
  const [idNumber, setIdNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const isoBirthDate = useMemo(() => toIsoDate(birthDate), [birthDate]);
  const canSave = Boolean(isoBirthDate) && Boolean(gender) && phone.trim().length >= 6 && idNumber.trim().length >= 4;

  const save = useCallback(async () => {
    if (!holder) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const updated = applyOnboarding(holder, {
        birthDate: isoBirthDate,
        gender: gender as never,
        phone: phone.trim(),
        idType,
        idNumber,
      });
      // Queued rather than written directly so it survives a flaky connection;
      // the key is per-patient-per-version so a replay cannot double-apply.
      await queueProfileEdit(updated, `profile-${holder.id}-${Date.now()}`);
      await refresh();
      router.replace('/onboarding/verify-id');
    } catch (err) {
      reportError(err, { source: 'onboarding-save' });
      setError(err instanceof Error ? err.message : 'Could not save your details. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [holder, isoBirthDate, gender, phone, idType, idNumber, refresh, router]);

  const remaining = onboardingStatus(holder);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Complete your profile' }} />

      <Text className="text-ink-secondary text-sm mt-2">
        {patientName(holder)}, Premier Health needs a few details before a clinician can rely on your record.
        {remaining.complete ? '' : ` ${remaining.done} of ${remaining.total} done.`}
      </Text>

      <SectionTitle>Date of birth</SectionTitle>
      <Card>
        <TextInput
          value={birthDate}
          onChangeText={setBirthDate}
          placeholder="DD/MM/YYYY"
          placeholderTextColor={colors.inkFaint}
          keyboardType="numbers-and-punctuation"
          className="text-ink text-base h-11"
        />
        {birthDate.length > 0 && !isoBirthDate ? (
          <Text className="text-status-error text-xs mt-1">Enter a real date, for example 29/10/1964.</Text>
        ) : null}
      </Card>

      <SectionTitle>Sex</SectionTitle>
      <View className="flex-row gap-2">
        {GENDERS.map((g) => (
          <Pressable
            key={g.key}
            onPress={() => setGender(g.key)}
            className={`flex-1 py-3 rounded-field items-center ${gender === g.key ? 'bg-phc-orange' : 'bg-surface-card'}`}
          >
            <Text className={`text-sm font-semibold ${gender === g.key ? 'text-white' : 'text-ink-secondary'}`}>
              {g.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle>Mobile number</SectionTitle>
      <Card>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="+237 6XX XXX XXX"
          placeholderTextColor={colors.inkFaint}
          keyboardType="phone-pad"
          className="text-ink text-base h-11"
        />
      </Card>

      <SectionTitle>Identity document</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {ID_DOCUMENT_TYPES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setIdType(t.key)}
            className={`px-3.5 py-2 rounded-pill ${idType === t.key ? 'bg-phc-orange' : 'bg-surface-card'}`}
          >
            <Text className={`text-sm font-medium ${idType === t.key ? 'text-white' : 'text-ink-secondary'}`}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Card className="mt-2">
        <TextInput
          value={idNumber}
          onChangeText={setIdNumber}
          placeholder="Document number"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="characters"
          className="text-ink text-base h-11"
        />
      </Card>
      <Text className="text-ink-faint text-xs mt-1">
        You do not need to be a Cameroonian national — a passport or residence permit is fine.
      </Text>

      {error ? <Text className="text-status-error text-sm mt-3">{error}</Text> : null}

      <Button
        label={busy ? 'Saving…' : 'Save and continue'}
        onPress={() => void save()}
        disabled={!canSave || busy}
        className="mt-4"
      />
      <Text className="text-ink-faint text-xs text-center mt-3">
        Saved on this device and sent when you have a connection.
      </Text>
    </Screen>
  );
}
