// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Alert, Badge, Divider, Group, Paper, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconMicrophone, IconMicrophoneOff, IconPhoneOff, IconSend, IconVideo, IconVideoOff } from '@tabler/icons-react';
import type { JSX, RefObject } from 'react';
import type { CallStatus } from './useVideoCall';
import { useVideoCall } from './useVideoCall';

export interface VideoVisitProps {
  /** Room id — typically a FHIR Appointment or Encounter id shared by both peers. */
  roomId: string;
  /** Start without video (audio-only) for very constrained connections. */
  audioOnly?: boolean;
  onLeave?: () => void;
}

/**
 * Compact video visit panel — used docked beside the encounter chart so the
 * clinician can document while on the call. The patient gets the full-screen
 * VideoVisitFullscreen instead.
 */
export function VideoVisit(props: VideoVisitProps): JSX.Element {
  const call = useVideoCall(props.roomId, props.audioOnly ?? false, props.onLeave);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Video visit</Text>
        <StatusBadge status={call.status} />
      </Group>

      {call.error && (
        <Alert color="red" variant="light">
          {call.error}
        </Alert>
      )}

      <Group grow align="stretch" wrap="nowrap">
        <VideoTile label="You" videoRef={call.localVideoRef} muted />
        <VideoTile label="Patient" videoRef={call.remoteVideoRef} />
      </Group>

      <Group justify="center" gap="md">
        <Tooltip label={call.micOn ? 'Mute' : 'Unmute'}>
          <ActionIcon
            size="xl"
            radius="xl"
            variant={call.micOn ? 'light' : 'filled'}
            color={call.micOn ? 'gray' : 'red'}
            onClick={call.toggleMic}
          >
            {call.micOn ? <IconMicrophone size={20} /> : <IconMicrophoneOff size={20} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={call.camOn ? 'Turn camera off' : 'Turn camera on'}>
          <ActionIcon
            size="xl"
            radius="xl"
            variant={call.camOn ? 'light' : 'filled'}
            color={call.camOn ? 'gray' : 'red'}
            onClick={call.toggleCam}
            disabled={call.audioOnly}
          >
            {call.camOn ? <IconVideo size={20} /> : <IconVideoOff size={20} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Leave">
          <ActionIcon size="xl" radius="xl" variant="filled" color="red" onClick={call.hangUp}>
            <IconPhoneOff size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider label="Chat" labelPosition="center" />
      <ScrollArea h={140} type="auto">
        <Stack gap={4}>
          {call.messages.length === 0 && (
            <Text size="xs" c="dimmed" ta="center">
              No messages yet
            </Text>
          )}
          {call.messages.map((m, i) => (
            <Text key={i} size="sm" ta={m.mine ? 'right' : 'left'} c={m.mine ? 'blue' : undefined}>
              {m.text}
            </Text>
          ))}
        </Stack>
      </ScrollArea>
      <Group gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          size="sm"
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
    </Stack>
  );
}

function VideoTile({
  label,
  videoRef,
  muted,
}: {
  label: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  muted?: boolean;
}): JSX.Element {
  return (
    <Paper withBorder radius="md" pos="relative" style={{ overflow: 'hidden', aspectRatio: '4 / 3', background: '#000' }}>
      <video ref={videoRef} autoPlay playsInline muted={muted} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <Badge pos="absolute" bottom={8} left={8} variant="filled" color="dark">
        {label}
      </Badge>
    </Paper>
  );
}

function StatusBadge({ status }: { status: CallStatus }): JSX.Element {
  const map: Record<CallStatus, { color: string; label: string }> = {
    connecting: { color: 'gray', label: 'Connecting…' },
    waiting: { color: 'blue', label: 'Waiting for patient…' },
    connected: { color: 'green', label: 'Connected' },
    ended: { color: 'gray', label: 'Call ended' },
    error: { color: 'red', label: 'Error' },
  };
  const { color, label } = map[status];
  return (
    <Badge color={color} variant="light">
      {label}
    </Badge>
  );
}
