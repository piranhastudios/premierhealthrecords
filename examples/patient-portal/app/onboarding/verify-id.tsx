import { Ionicons } from '@expo/vector-icons';
import { useMedplum } from '@medplum/react-hooks';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Button, Card, Screen } from '../../src/components/ui';
import { useActiveProfile } from '../../src/hooks/useActiveProfile';
import {
  IDENTITY_RETENTION_DAYS,
  latestIdentityDocument,
  uploadIdentityDocument,
  verificationStateOf,
  type VerificationState,
} from '../../src/lib/identityDocument';
import { posthog } from '../../src/lib/posthog';
import { reportError } from '../../src/lib/reporting';
import { colors } from '../../src/theme/tokens';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  quality: 0.7,
  // No base64: the file is read straight into a Blob for upload, and holding a
  // megabyte of identity document in JS memory serves no purpose.
  base64: false,
};

const STATE_COPY: Record<VerificationState, { title: string; body: string; tone: string }> = {
  none: {
    title: 'Confirm your identity',
    body: 'Take a photo of the document you told us about. A member of staff checks it and confirms your record.',
    tone: 'text-ink-secondary',
  },
  pending: {
    title: 'Waiting for review',
    body: 'Your document has been sent. A member of staff will check it shortly — you do not need to do anything else.',
    tone: 'text-ink-secondary',
  },
  verified: {
    title: 'Identity confirmed',
    body: 'Your health ID card can be used at any Premier Health centre.',
    tone: 'text-status-success',
  },
  rejected: {
    title: 'We could not read your document',
    body: 'Please take another photo, making sure the whole document is visible and in focus.',
    tone: 'text-status-error',
  },
};

/**
 * Upload a photograph of an identity document for staff to verify.
 *
 * The document is held for {@link IDENTITY_RETENTION_DAYS} days and then
 * deleted automatically by the purge-identity-documents bot. That is stated on
 * screen, because a patient handing over a passport photograph deserves to know
 * how long it is kept.
 */
export default function VerifyId(): JSX.Element {
  const medplum = useMedplum();
  const router = useRouter();
  const { holder } = useActiveProfile();

  const [state, setState] = useState<VerificationState>('none');
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!holder?.id) {
        setChecking(false);
        return;
      }
      try {
        setState(verificationStateOf(await latestIdentityDocument(medplum, holder.id)));
      } catch (err) {
        // Offline, or the search failed. Let them upload anyway rather than
        // blocking on a status read.
        reportError(err, { source: 'verify-id-status' });
      } finally {
        setChecking(false);
      }
    })();
  }, [medplum, holder?.id]);

  const pick = useCallback(async (fromCamera: boolean) => {
    setError(undefined);
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        fromCamera
          ? 'Premier Health needs camera access to photograph your document.'
          : 'Premier Health needs access to your photos to attach your document.'
      );
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0]) {
      setPreview(result.assets[0].uri);
    }
  }, []);

  const upload = useCallback(async () => {
    if (!holder || !preview) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await uploadIdentityDocument(medplum, holder, { uri: preview });
      posthog?.capture('identity_document_submitted');
      setState('pending');
      setPreview(undefined);
    } catch (err) {
      reportError(err, { source: 'verify-id-upload' });
      setError(
        err instanceof Error
          ? `Could not send your document: ${err.message}`
          : 'Could not send your document. Please try again when you have a connection.'
      );
    } finally {
      setBusy(false);
    }
  }, [medplum, holder, preview]);

  const copy = STATE_COPY[state];
  const canUpload = state !== 'verified' && state !== 'pending';

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Identity check' }} />

      <View className="items-center mt-4 mb-1">
        <View className="w-16 h-16 rounded-full bg-phc-orange/12 items-center justify-center mb-3">
          <Ionicons
            name={state === 'verified' ? 'shield-checkmark' : 'card'}
            size={32}
            color={state === 'verified' ? colors.success : colors.orange}
          />
        </View>
        <Text className="text-ink text-xl font-bold text-center">{copy.title}</Text>
        <Text className={`text-sm text-center mt-1 ${copy.tone}`}>{copy.body}</Text>
      </View>

      {preview ? (
        <Card className="p-0 overflow-hidden">
          <Image source={{ uri: preview }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
        </Card>
      ) : null}

      {error ? <Text className="text-status-error text-sm mt-2">{error}</Text> : null}

      {checking ? null : canUpload ? (
        <View className="mt-3 gap-2">
          <Button label={preview ? 'Retake photo' : 'Take a photo'} onPress={() => void pick(true)} disabled={busy} />
          <Button
            label="Choose from my photos"
            variant="secondary"
            onPress={() => void pick(false)}
            disabled={busy}
          />
          {preview ? (
            <Button label={busy ? 'Sending…' : 'Send for review'} onPress={() => void upload()} disabled={busy} />
          ) : null}
        </View>
      ) : null}

      <Button
        label={state === 'none' ? 'Skip for now' : 'Continue'}
        variant={state === 'none' ? 'ghost' : 'primary'}
        onPress={() => router.replace('/onboarding/intro-visit')}
        className="mt-3"
      />

      <Card className="mt-2">
        <View className="flex-row">
          <Ionicons name="time" size={16} color={colors.inkFaint} />
          <Text className="text-ink-faint text-xs ml-2 flex-1">
            Your document is kept for {IDENTITY_RETENTION_DAYS} days so staff can check it, then deleted
            automatically. It is never shown on your health ID card.
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
