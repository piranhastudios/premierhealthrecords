import type { Patient } from '@medplum/fhirtypes';
import { Text, View } from 'react-native';
import { Card } from './ui';
import { formatDate, patientCni, patientMrn, patientName } from '../lib/format';

/** Whole years, because "34" is what a clinician writes down, not a birth date. */
function ageFrom(birthDate?: string): string | undefined {
  if (!birthDate) {
    return undefined;
  }
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) {
    return undefined;
  }
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? `${age}` : undefined;
}

/**
 * Who this record belongs to.
 *
 * A summary handed to a clinician who has never met this patient is unusable —
 * and unsafe to act on — without identity on the same screen as the clinical
 * detail. Name, age, sex and a record number are the minimum to match a person
 * to a chart.
 */
export function PatientIdentityCard({ patient, asOf }: { patient?: Patient; asOf?: string }): JSX.Element {
  const age = ageFrom(patient?.birthDate);
  const mrn = patientMrn(patient);
  const cni = patientCni(patient);

  return (
    <Card>
      <Text className="text-ink text-lg font-bold">{patientName(patient)}</Text>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-1">
        {patient?.birthDate ? (
          <Text className="text-ink-secondary text-sm">
            Born {formatDate(patient.birthDate)}
            {age ? ` · ${age} yrs` : ''}
          </Text>
        ) : null}
        {patient?.gender ? <Text className="text-ink-secondary text-sm capitalize">{patient.gender}</Text> : null}
      </View>
      {mrn || cni ? (
        <Text className="text-ink-faint text-xs mt-1">
          {[mrn ? `MRN ${mrn}` : undefined, cni ? `CNI ${cni}` : undefined].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {/* Freshness sits with identity on purpose: a clinician must be able to
          see at a glance how old this copy is before acting on it. */}
      <View className="border-t border-line mt-3 pt-2">
        <Text className="text-ink-faint text-xs">
          {asOf ? `Record last updated ${formatDate(asOf)}` : 'This record has not synced yet'}
        </Text>
        <Text className="text-ink-faint text-xs">Stored on this device · readable without a connection</Text>
      </View>
    </Card>
  );
}
