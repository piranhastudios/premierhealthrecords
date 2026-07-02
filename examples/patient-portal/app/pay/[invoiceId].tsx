import { Ionicons } from '@expo/vector-icons';
import type { Invoice, Parameters } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, Loading } from '../../src/components/ui';
import { CORRESPONDENTS } from '../../src/lib/constants';
import { formatMoney } from '../../src/lib/format';
import { colors } from '../../src/theme/tokens';

type Method = 'momo' | 'card';
type Phase = 'form' | 'pending' | 'done' | 'error';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX = 20;

export default function PayScreen(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<Invoice>();
  const [method, setMethod] = useState<Method>('momo');
  const [phase, setPhase] = useState<Phase>('form');
  const [message, setMessage] = useState<string>();

  // momo
  const [phone, setPhone] = useState('');
  const [correspondent, setCorrespondent] = useState<string>(CORRESPONDENTS[0].value);
  // card
  const [email, setEmail] = useState('');

  useEffect(() => {
    medplum
      .readResource('Invoice', String(invoiceId))
      .then(setInvoice)
      .catch(() => setMessage('Invoice not found.'));
  }, [medplum, invoiceId]);

  const pollUntilBalanced = useCallback(async (): Promise<boolean> => {
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const fresh = await medplum.readResource('Invoice', String(invoiceId));
        if (fresh.status === 'balanced') {
          return true;
        }
      } catch {
        // keep polling
      }
    }
    return false;
  }, [medplum, invoiceId]);

  async function payMomo(): Promise<void> {
    setPhase('pending');
    setMessage('Check your phone to approve the payment…');
    try {
      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'payerPhone', valueString: phone },
          { name: 'correspondent', valueString: correspondent },
        ],
      };
      await medplum.post(medplum.fhirUrl('Invoice', String(invoiceId), '$pay'), params);
      finish(await pollUntilBalanced());
    } catch (err) {
      fail(err);
    }
  }

  async function payCard(): Promise<void> {
    setPhase('pending');
    setMessage('Opening secure checkout…');
    try {
      const params: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'payerEmail', valueString: email },
          { name: 'successUrl', valueString: 'https://premierhealth.cm/pay/success' },
          { name: 'cancelUrl', valueString: 'https://premierhealth.cm/pay/cancel' },
        ],
      };
      const result = (await medplum.post(medplum.fhirUrl('Invoice', String(invoiceId), '$checkout'), params)) as Parameters;
      const url = result.parameter?.find((p) => p.name === 'checkoutUrl')?.valueString;
      if (!url) {
        throw new Error('Could not start checkout.');
      }
      await WebBrowser.openBrowserAsync(url);
      setMessage('Confirming your payment…');
      finish(await pollUntilBalanced());
    } catch (err) {
      fail(err);
    }
  }

  function finish(ok: boolean): void {
    if (ok) {
      setPhase('done');
      setMessage('Payment received. Thank you!');
    } else {
      setPhase('error');
      setMessage('We could not confirm the payment yet. It may still complete shortly.');
    }
  }

  function fail(err: unknown): void {
    setPhase('error');
    setMessage(err instanceof Error ? err.message : 'Payment failed.');
  }

  if (!invoice) {
    return (
      <View className="flex-1 bg-surface-bg">
        <Loading />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-bg px-5 pt-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-ink text-xl font-bold">Pay invoice</Text>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={colors.ink} />
        </Pressable>
      </View>

      <Card className="items-center mb-4">
        <Text className="text-ink-secondary text-sm">Amount due</Text>
        <Text className="text-ink text-3xl font-extrabold mt-1">{formatMoney(invoice.totalGross ?? invoice.totalNet)}</Text>
      </Card>

      {phase === 'done' || phase === 'pending' || phase === 'error' ? (
        <Card className="items-center gap-3">
          {phase === 'pending' ? <Loading label={message} /> : null}
          {phase === 'done' ? <Ionicons name="checkmark-circle" size={48} color={colors.success} /> : null}
          {phase === 'error' ? <Ionicons name="alert-circle" size={48} color={colors.error} /> : null}
          {phase !== 'pending' ? <Text className="text-ink text-center">{message}</Text> : null}
          {phase === 'done' ? <Button label="Done" onPress={() => router.back()} /> : null}
          {phase === 'error' ? <Button label="Try again" variant="secondary" onPress={() => setPhase('form')} /> : null}
        </Card>
      ) : (
        <>
          <View className="flex-row bg-surface-card rounded-pill p-1 mb-4">
            {(['momo', 'card'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMethod(m)} className={`flex-1 py-2.5 rounded-pill items-center ${method === m ? 'bg-phc-orange' : ''}`}>
                <Text className={`text-sm font-semibold ${method === m ? 'text-white' : 'text-ink-secondary'}`}>
                  {m === 'momo' ? 'Mobile money' : 'Card'}
                </Text>
              </Pressable>
            ))}
          </View>

          {method === 'momo' ? (
            <Card className="gap-3">
              <TextInput placeholder="+237 6 90 00 00 00" value={phone} onChangeText={setPhone} keyboardType="phone-pad" className="h-12 px-3 bg-surface-muted rounded-field text-ink" placeholderTextColor="#9A8B82" />
              <View className="flex-row gap-2">
                {CORRESPONDENTS.map((c) => (
                  <Pressable key={c.value} onPress={() => setCorrespondent(c.value)} className={`flex-1 py-2.5 rounded-field items-center ${correspondent === c.value ? 'bg-phc-orange/15 border border-phc-orange' : 'bg-surface-muted'}`}>
                    <Text className={`text-xs font-semibold ${correspondent === c.value ? 'text-phc-orange' : 'text-ink-secondary'}`}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Button label="Request payment" onPress={payMomo} disabled={!phone} />
            </Card>
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-start gap-2">
                <Ionicons name="globe" size={16} color={colors.orange} />
                <Text className="text-ink-secondary text-xs flex-1">
                  Paying from abroad? You&apos;ll be shown and charged in your local currency at Stripe&apos;s
                  live exchange rate on the next screen.
                </Text>
              </View>
              <TextInput placeholder="Email for receipt" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" className="h-12 px-3 bg-surface-muted rounded-field text-ink" placeholderTextColor="#9A8B82" />
              <Button label="Pay by card" onPress={payCard} disabled={!email} />
            </Card>
          )}
        </>
      )}
    </View>
  );
}
