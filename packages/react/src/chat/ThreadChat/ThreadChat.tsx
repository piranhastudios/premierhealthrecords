// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { createReference, formatCodeableConcept, getReferenceString } from '@medplum/core';
import type { Communication, CommunicationPayload, DocumentReference, Reference } from '@medplum/fhirtypes';
import { useMedplum, useMedplumProfile, usePrevious } from '@medplum/react-hooks';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SendMessageOptions } from '../BaseChat/BaseChat';
import { BaseChat } from '../BaseChat/BaseChat';
import { ChannelReplyControls } from '../ChannelReply/ChannelReplyControls';
import type { SelectedTemplate } from '../ChannelReply/constants';
import {
  channelToMedium,
  getThreadChannel,
  getWhatsappWindowExpiresAt,
  isWhatsappWindowOpen,
  whatsappTemplateExtension,
} from '../ChannelReply/constants';
import { WhatsAppWindowBanner } from '../ChannelReply/WhatsAppWindowBanner';

export interface ThreadChatProps {
  readonly thread: Communication;
  readonly title?: string;
  readonly onMessageSent?: (message: Communication) => void;
  readonly inputDisabled?: boolean;
  readonly excludeHeader?: boolean;
  readonly uploadEnabled?: boolean;
  readonly onError?: (err: Error) => void;
  readonly onViewInDocuments?: (reference: Reference<DocumentReference>) => void;
}

export function ThreadChat(props: ThreadChatProps): JSX.Element | null {
  const { thread, title, onMessageSent, inputDisabled, excludeHeader, uploadEnabled, onError, onViewInDocuments } =
    props;
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const prevThreadId = usePrevious(thread?.id);
  const [communications, setCommunications] = useState<Communication[]>([]);

  const profileRef = useMemo(() => (profile ? createReference(profile) : undefined), [profile]);
  const threadRef = useMemo(() => createReference(thread), [thread]);

  // Channel awareness derived entirely from the thread header.
  const channel = useMemo(() => getThreadChannel(thread), [thread]);
  const windowExpiresAt = useMemo(() => getWhatsappWindowExpiresAt(thread), [thread]);
  const whatsappWindowClosed = channel === 'whatsapp' && !isWhatsappWindowOpen(thread);

  useEffect(() => {
    if (thread?.id !== prevThreadId) {
      setCommunications([]);
    }
  }, [thread?.id, prevThreadId]);

  const sendMessage = useCallback(
    (message: string, file?: File, existingDocRef?: DocumentReference, options?: SendMessageOptions) => {
      const profileRefStr = profileRef ? getReferenceString(profileRef) : undefined;
      if (!profileRefStr) {
        return;
      }

      const buildAndSend = async (): Promise<void> => {
        const payload: CommunicationPayload[] = [];
        if (message) {
          payload.push({ contentString: message });
        }
        if (existingDocRef) {
          payload.push({ contentReference: createReference(existingDocRef) });
        } else if (file) {
          const docRef = await medplum.createDocumentReference({
            data: file,
            contentType: file.type || 'application/octet-stream',
            filename: file.name,
            additionalFields: {
              ...(thread.subject ? { subject: thread.subject } : {}),
              description: file.name,
            },
          });
          payload.push({ contentReference: createReference(docRef) });
        }
        const communication = await medplum.createResource<Communication>({
          resourceType: 'Communication',
          status: 'in-progress',
          sender: profileRef,
          recipient: thread.recipient?.filter((ref) => getReferenceString(ref) !== profileRefStr) ?? [],
          sent: new Date().toISOString(),
          payload,
          partOf: [threadRef],
          subject: thread.subject,
          // Stamp the thread's channel so the outbound bot knows how to deliver it.
          ...(channel ? { medium: [channelToMedium(channel)] } : {}),
          // Carry the WhatsApp template intent for the outbound bot to resolve.
          ...(options?.templateSid
            ? { extension: [whatsappTemplateExtension({ sid: options.templateSid, vars: options.templateVars ?? {} })] }
            : {}),
        });
        setCommunications((prev) => [...prev, communication]);
        onMessageSent?.(communication);
      };

      buildAndSend().catch(console.error);
    },
    [medplum, profileRef, thread, threadRef, channel, onMessageSent]
  );

  const handleSendTemplate = useCallback(
    (template: SelectedTemplate) => {
      sendMessage(template.preview, undefined, undefined, { templateSid: template.sid, templateVars: template.vars });
    },
    [sendMessage]
  );

  // Currently we only support `delivered` on chats with 2 participants
  // Normally we would use `useCallback` to memoize a function
  // But in this case we only want to conditionally pass a function if the thread has 2 participants...
  // If the thread has 3 or more participants, we do not pass this function; instead we pass undefined
  const onMessageReceived = useMemo(
    () =>
      thread.recipient?.length === 2
        ? (message: Communication): void => {
            if (!(message.received && message.status === 'completed')) {
              medplum
                .updateResource({
                  ...message,
                  received: message.received ?? new Date().toISOString(), // Mark as received if needed
                  status: 'completed', // Mark as 'read'
                  // See: https://www.medplum.com/docs/communications/messaging-data-model#communication-lifecycle
                  // for more info about recommended `Communication` lifecycle
                })
                .catch(console.error);
            }
          }
        : undefined,
    [medplum, thread.recipient?.length]
  );

  if (!profile) {
    return null;
  }

  return (
    <BaseChat
      title={title ?? (thread?.topic ? formatCodeableConcept(thread.topic) : '[No thread title]')}
      communications={communications}
      setCommunications={setCommunications}
      query={`part-of=Communication/${thread.id as string}`}
      sendMessage={sendMessage}
      onMessageReceived={onMessageReceived}
      inputDisabled={inputDisabled || whatsappWindowClosed}
      inputDisabledReason={whatsappWindowClosed ? 'WhatsApp 24h window closed — send an approved template' : undefined}
      excludeHeader={excludeHeader}
      uploadEnabled={uploadEnabled}
      onError={onError}
      attachmentSubjectRef={thread.subject}
      onViewInDocuments={onViewInDocuments}
      headerBanner={channel === 'whatsapp' ? <WhatsAppWindowBanner expiresAt={windowExpiresAt} /> : undefined}
      inputAccessory={
        channel ? <ChannelReplyControls channel={channel} onSendTemplate={handleSendTemplate} /> : undefined
      }
    />
  );
}
