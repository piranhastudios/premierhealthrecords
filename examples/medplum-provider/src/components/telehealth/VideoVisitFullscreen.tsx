// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Box, Group, Indicator, Loader, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconMessage,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconSend,
  IconVideo,
  IconVideoOff,
  IconX,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { CallStatus } from './useVideoCall';
import { useVideoCall } from './useVideoCall';

export interface VideoVisitFullscreenProps {
  roomId: string;
  audioOnly?: boolean;
  onLeave?: () => void;
}

const STATUS_TEXT: Record<CallStatus, string> = {
  connecting: 'Starting your camera…',
  waiting: 'Waiting for the other person to join…',
  connected: '',
  ended: 'The call has ended.',
  error: 'Could not connect.',
};

/**
 * Full-screen, Google-Meet-style telemedicine call for the patient (and any
 * full-screen use). Remote video fills the screen, the local camera is a small
 * inset, controls float at the bottom, and chat is a side panel (desktop) /
 * full-width overlay (mobile). Responsive down to phones.
 */
export function VideoVisitFullscreen(props: VideoVisitFullscreenProps): JSX.Element {
  const call = useVideoCall(props.roomId, props.audioOnly ?? false, props.onLeave);
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    if (chatOpen) {
      setSeen(call.messages.length);
    }
  }, [chatOpen, call.messages.length]);
  const unread = !chatOpen ? Math.max(0, call.messages.length - seen) : 0;

  return (
    <Box style={{ position: 'fixed', inset: 0, background: '#202124', display: 'flex' }}>
      {/* Main stage */}
      <Box style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <video
          ref={call.remoteVideoRef}
          autoPlay
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#202124' }}
        />

        {call.status !== 'connected' && (
          <Stack
            align="center"
            justify="center"
            gap="sm"
            style={{ position: 'absolute', inset: 0, zIndex: 1, textAlign: 'center', padding: 24 }}
          >
            {(call.status === 'connecting' || call.status === 'waiting') && <Loader color="gray" />}
            <Text c="white" size="lg" fw={500}>
              {call.error ?? STATUS_TEXT[call.status]}
            </Text>
          </Stack>
        )}

        <Text
          style={{ position: 'absolute', top: 16, left: 20, zIndex: 2, color: 'rgba(255,255,255,0.85)' }}
          fw={700}
        >
          Premier Health
        </Text>

        {/* Local camera inset */}
        <Box
          style={{
            position: 'absolute',
            right: 16,
            bottom: 100,
            width: 'clamp(96px, 22vw, 180px)',
            aspectRatio: '4 / 3',
            borderRadius: 12,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.25)',
            background: '#000',
            zIndex: 2,
          }}
        >
          <video
            ref={call.localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
        </Box>

        {/* Floating controls */}
        <Group
          justify="center"
          gap="sm"
          style={{ position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 3 }}
        >
          <ControlButton
            label={call.micOn ? 'Mute' : 'Unmute'}
            danger={!call.micOn}
            onClick={call.toggleMic}
            icon={call.micOn ? <IconMicrophone size={22} /> : <IconMicrophoneOff size={22} />}
          />
          <ControlButton
            label={call.camOn ? 'Turn camera off' : 'Turn camera on'}
            danger={!call.camOn}
            disabled={call.audioOnly}
            onClick={call.toggleCam}
            icon={call.camOn ? <IconVideo size={22} /> : <IconVideoOff size={22} />}
          />
          <Indicator disabled={unread === 0} color="red" size={10} offset={6}>
            <ControlButton
              label="Chat"
              active={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
              icon={<IconMessage size={22} />}
            />
          </Indicator>
          <ControlButton label="Leave" hangup onClick={call.hangUp} icon={<IconPhoneOff size={22} />} />
        </Group>
      </Box>

      {/* Chat panel: side panel on desktop, full-width overlay on mobile */}
      {chatOpen && (
        <Box
          style={{
            width: 'min(360px, 100vw)',
            flexShrink: 0,
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          <Group justify="space-between" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <Text fw={600}>Chat</Text>
            <ActionIcon variant="subtle" color="gray" onClick={() => setChatOpen(false)} aria-label="Close chat">
              <IconX size={18} />
            </ActionIcon>
          </Group>
          <ScrollArea style={{ flex: 1 }} p="sm">
            <Stack gap={6}>
              {call.messages.length === 0 && (
                <Text size="sm" c="dimmed" ta="center">
                  No messages yet
                </Text>
              )}
              {call.messages.map((m, i) => (
                <Box key={i} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <Box
                    px="sm"
                    py={6}
                    style={{
                      borderRadius: 12,
                      background: m.mine ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-gray-1)',
                      color: m.mine ? '#fff' : undefined,
                    }}
                  >
                    <Text size="sm">{m.text}</Text>
                  </Box>
                </Box>
              ))}
            </Stack>
          </ScrollArea>
          <Group p="sm" gap="xs" wrap="nowrap" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
            <TextInput
              flex={1}
              placeholder="Type a message"
              value={call.chatText}
              onChange={(e) => call.setChatText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  call.sendChat();
                }
              }}
            />
            <ActionIcon size="lg" variant="filled" onClick={call.sendChat} aria-label="Send message">
              <IconSend size={16} />
            </ActionIcon>
          </Group>
        </Box>
      )}
    </Box>
  );
}

function ControlButton(props: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  hangup?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const color = props.hangup || props.danger ? 'red' : 'gray';
  const variant = props.hangup ? 'filled' : props.active ? 'white' : 'filled';
  return (
    <Tooltip label={props.label}>
      <ActionIcon
        size={56}
        radius="xl"
        variant={variant}
        color={color}
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props.label}
        style={props.hangup ? undefined : { background: props.active ? '#fff' : 'rgba(255,255,255,0.15)', color: '#fff' }}
      >
        {props.icon}
      </ActionIcon>
    </Tooltip>
  );
}
