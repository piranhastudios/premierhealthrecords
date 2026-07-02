import { Ionicons } from '@expo/vector-icons';
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Avatar, Button, Card, Screen } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { patientInitials, patientName } from '../../../src/lib/format';
import { colors } from '../../../src/theme/tokens';

export default function Family(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { profiles, activePatient, holder, setActivePatientId, refresh } = useActiveProfile();
  const [mode, setMode] = useState<'none' | 'dependent' | 'invite'>('none');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function addDependent(): Promise<void> {
    if (!holder?.id || !name.trim()) {
      return;
    }
    setBusy(true);
    try {
      const [given, ...family] = name.trim().split(' ');
      const dependent = await medplum.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: [given], family: family.join(' ') || undefined }],
        birthDate: birthDate || undefined,
        managingOrganization: holder.managingOrganization,
        meta: holder.meta?.accounts ? { accounts: holder.meta.accounts } : undefined,
      });
      await medplum.updateResource({
        ...holder,
        link: [...(holder.link ?? []), { type: 'seealso', other: { reference: `Patient/${dependent.id}` } }],
      });
      await refresh();
      reset();
      Alert.alert('Added', `${name} is now in your family.`);
    } catch {
      Alert.alert('Could not add', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function invite(): Promise<void> {
    if (!name.trim() || !contact.trim()) {
      return;
    }
    setBusy(true);
    try {
      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'name', valueString: name.trim() },
          { name: 'contact', valueString: contact.trim() },
        ],
      };
      await medplum.post(medplum.fhirUrl('Patient', '$invite-family-member'), params);
      reset();
      Alert.alert('Invite sent', `${name} will receive a link to join your family.`);
    } catch {
      Alert.alert('Could not invite', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    setMode('none');
    setName('');
    setContact('');
    setBirthDate('');
  }

  return (
    <Screen edges={[]}>
      <Text className="text-ink-secondary text-sm mt-2">Switch who you are viewing, add a dependent, or invite an adult relative to keep their own login.</Text>

      {profiles.map((p) => {
        const active = p.id === activePatient?.id;
        return (
          <Card key={p.id} onPress={() => setActivePatientId(p.id as string)}>
            <View className="flex-row items-center">
              <Avatar initials={patientInitials(p)} size={44} />
              <View className="ml-3 flex-1">
                <Text className="text-ink font-semibold">{patientName(p)}</Text>
                <Text className="text-ink-secondary text-xs">{p.id === holder?.id ? 'You' : 'Dependent'}</Text>
              </View>
              {active ? <Ionicons name="checkmark-circle" size={22} color={colors.orange} /> : null}
            </View>
          </Card>
        );
      })}

      {mode === 'none' ? (
        <View className="flex-row gap-3 mt-1">
          <Button label="Add dependent" variant="secondary" className="flex-1" onPress={() => setMode('dependent')} />
          <Button label="Invite relative" variant="secondary" className="flex-1" onPress={() => setMode('invite')} />
        </View>
      ) : (
        <Card className="gap-2">
          <Text className="text-ink font-semibold">{mode === 'dependent' ? 'Add a dependent' : 'Invite a relative'}</Text>
          <TextInput placeholder="Full name" value={name} onChangeText={setName} className="h-11 px-3 bg-surface-muted rounded-field text-ink" placeholderTextColor="#9A8B82" />
          {mode === 'dependent' ? (
            <TextInput placeholder="Birth date (YYYY-MM-DD)" value={birthDate} onChangeText={setBirthDate} className="h-11 px-3 bg-surface-muted rounded-field text-ink" placeholderTextColor="#9A8B82" />
          ) : (
            <TextInput placeholder="Phone or email" value={contact} onChangeText={setContact} autoCapitalize="none" className="h-11 px-3 bg-surface-muted rounded-field text-ink" placeholderTextColor="#9A8B82" />
          )}
          <View className="flex-row gap-2 mt-1">
            <Button label="Cancel" variant="ghost" className="flex-1" onPress={reset} />
            <Button label={mode === 'dependent' ? 'Add' : 'Send invite'} className="flex-1" loading={busy} onPress={mode === 'dependent' ? addDependent : invite} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
