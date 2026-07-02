import { Ionicons } from '@expo/vector-icons';
import { getReferenceString } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile, useSubscription } from '@medplum/react-hooks';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ChatBubble } from '../../../src/components/ChatBubble';
import { Loading } from '../../../src/components/ui';
import { useActiveProfile } from '../../../src/hooks/useActiveProfile';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { enqueueOutbox } from '../../../src/offline/repositories';
import { colors } from '../../../src/theme/tokens';

export default function ChatThread(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { online } = useNetworkStatus();
  const { activePatient } = useActiveProfile();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const [messages, setMessages] = useState<Communication[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const results = await medplum.searchResources(
        'Communication',
        `part-of=Communication/${threadId}&_sort=sent&_count=200`
      );
      setMessages(results);
    } catch {
      // keep what we have
    } finally {
      setLoading(false);
    }
  }, [medplum, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: refetch when a new message lands in this thread.
  useSubscription(`Communication?part-of=Communication/${threadId}`, () => {
    void load();
  });

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || !activePatient?.id) {
      return;
    }
    setDraft('');
    const message: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      partOf: [{ reference: `Communication/${threadId}` }],
      subject: { reference: `Patient/${activePatient.id}` },
      sender: profile ? { reference: getReferenceString(profile) } : undefined,
      sent: new Date().toISOString(),
      payload: [{ contentString: text }],
    };
    setMessages((prev) => [...prev, message]);
    try {
      if (online) {
        await medplum.createResource(message);
      } else {
        await enqueueOutbox({ id: `msg-${Date.now()}`, kind: 'message', payload: message, idempotencyKey: `msg-${Date.now()}` });
      }
    } catch {
      // optimistic message stays; will retry via outbox next sync
    }
  }

  const myRef = profile ? getReferenceString(profile) : undefined;

  return (
    <KeyboardAvoidingView className="flex-1 bg-surface-bg" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {loading ? (
        <Loading />
      ) : (
        <ScrollView ref={scrollRef} className="flex-1 px-4" contentContainerClassName="py-3">
          {messages.map((m, i) => (
            <ChatBubble
              key={m.id ?? `local-${i}`}
              text={m.payload?.[0]?.contentString ?? ''}
              mine={m.sender?.reference === myRef}
              time={m.sent ? new Date(m.sent).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined}
            />
          ))}
        </ScrollView>
      )}
      <View className="flex-row items-center px-3 py-2 bg-surface-card border-t border-line">
        <TextInput
          placeholder="Send a message…"
          value={draft}
          onChangeText={setDraft}
          className="flex-1 h-11 px-3 text-ink"
          placeholderTextColor="#9A8B82"
          multiline
        />
        <Pressable onPress={send} className="w-11 h-11 rounded-full bg-phc-orange items-center justify-center ml-1">
          <Ionicons name="send" size={18} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
