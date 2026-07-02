import { Text, View } from 'react-native';

type Tone = 'neutral' | 'success' | 'warn' | 'error' | 'brand';

const toneMap: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: 'bg-surface-muted', text: 'text-ink-secondary' },
  success: { bg: 'bg-status-success/15', text: 'text-status-success' },
  warn: { bg: 'bg-status-warn/15', text: 'text-phc-ember' },
  error: { bg: 'bg-status-error/15', text: 'text-status-error' },
  brand: { bg: 'bg-phc-orange/15', text: 'text-phc-orange' },
};

/** Maps a FHIR-ish status string to a tone. */
export function statusTone(status?: string): Tone {
  switch (status) {
    case 'balanced':
    case 'completed':
    case 'active':
    case 'arrived':
    case 'fulfilled':
      return 'success';
    case 'issued':
    case 'pending':
    case 'booked':
    case 'proposed':
      return 'warn';
    case 'cancelled':
    case 'entered-in-error':
    case 'noshow':
      return 'error';
    default:
      return 'neutral';
  }
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }): JSX.Element {
  const { bg, text } = toneMap[tone];
  return (
    <View className={`px-2.5 py-1 rounded-pill ${bg}`}>
      <Text className={`text-xs font-semibold capitalize ${text}`}>{label}</Text>
    </View>
  );
}
