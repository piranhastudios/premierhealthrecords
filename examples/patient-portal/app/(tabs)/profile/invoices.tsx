import type { Invoice } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Card, EmptyState, Loading, Screen, statusTone } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { formatDate, formatMoney } from '../../../src/lib/format';
import { getCachedInvoices, upsertInvoices } from '../../../src/offline/repositories';

export default function Invoices(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { activePatient } = useActiveProfile();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activePatient?.id) {
      return;
    }
    // 1. Instant: cached invoices (works offline).
    setInvoices(await getCachedInvoices(activePatient.id));
    setLoading(false);
    // 2. Refresh from server when possible.
    try {
      const live = await medplum.searchResources('Invoice', `subject=Patient/${activePatient.id}&_sort=-_lastUpdated&_count=50`);
      setInvoices(live);
      await upsertInvoices(live);
    } catch {
      // offline — keep cache
    }
  }, [medplum, activePatient?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen edges={[]} refreshing={false} onRefresh={load}>
      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" />
      ) : (
        invoices.map((inv) => {
          const payable = inv.status === 'issued';
          return (
            <Card key={inv.id}>
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-ink font-bold text-base">{formatMoney(inv.totalGross ?? inv.totalNet)}</Text>
                  <Text className="text-ink-secondary text-xs mt-0.5">{formatDate(inv.date)}</Text>
                </View>
                <Badge label={inv.status ?? 'draft'} tone={statusTone(inv.status)} />
              </View>
              {payable ? (
                <Button label="Pay now" className="mt-3" onPress={() => router.push(`/pay/${inv.id}`)} />
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
