// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Alert, Badge, Divider, Group, Paper, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconSend,
  IconVideo,
  IconVideoOff,
} from '@tabler/icons-react';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Conservative defaults for low-bandwidth links (typical of Cameroon mobile networks).
const MAX_VIDEO_BITRATE = 300_000; // 300 kbps
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 480 },
  height: { ideal: 360 },
  frameRate: { ideal: 15, max: 20 },
};

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

type Status = 'connecting' | 'waiting' | 'connected' | 'ended' | 'error';

export interface VideoVisitProps {
  /** Room id — typically a FHIR Appointment or Encounter id shared by both peers. */
  roomId: string;
  /** Start without video (audio-only) for very constrained connections. */
  audioOnly?: boolean;
  onLeave?: () => void;
}

/**
 * One-to-one WebRTC video visit. Media is peer-to-peer; only SDP/ICE pass through
 * the server's `/ws/telehealth` signaling relay. Video bitrate is capped and an
 * audio-only fallback is available to cope with low bandwidth.
 */
export function VideoVisit(props: VideoVisitProps): JSX.Element {
  const { roomId, onLeave } = props;
  const medplum = useMedplum();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string>();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!props.audioOnly);
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([]);
  const [chatText, setChatText] = useState('');

  const send = useCallback((msg: unknown): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Caps the outbound video bitrate to stay usable on slow links.
  const applyBitrateCap = useCallback((pc: RTCPeerConnection): void => {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) {
      return;
    }
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
    sender.setParameters(params).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: props.audioOnly ? false : VIDEO_CONSTRAINTS,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            send({ type: 'ice', candidate: e.candidate });
          }
        };
        pc.ontrack = (e) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = e.streams[0];
          }
          setStatus('connected');
        };

        const wsUrl = medplum.getBaseUrl().replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/telehealth';
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join', room: roomId }));
          setStatus('waiting');
        };
        ws.onerror = () => {
          if (!cancelled) {
            setStatus('error');
            setError('Signaling connection failed');
          }
        };
        ws.onmessage = async (event) => {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
          switch (msg.type) {
            case 'peer-joined': {
              // A peer arrived while we were waiting — we initiate the offer.
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              applyBitrateCap(pc);
              send({ type: 'offer', sdp: pc.localDescription });
              break;
            }
            case 'offer': {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              applyBitrateCap(pc);
              send({ type: 'answer', sdp: pc.localDescription });
              break;
            }
            case 'answer':
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              break;
            case 'ice':
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => undefined);
              break;
            case 'peer-left':
              setStatus('ended');
              break;
            case 'chat':
              setMessages((m) => [...m, { mine: false, text: String(msg.text ?? '') }]);
              break;
            default:
              break;
          }
        };
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Could not start the call');
        }
      }
    }

    start().catch(() => undefined);

    return () => {
      cancelled = true;
      wsRef.current?.close();
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [roomId, props.audioOnly, medplum, send, applyBitrateCap]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
    }
  }, []);

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
    }
  }, []);

  const hangUp = useCallback(() => {
    send({ type: 'bye' });
    wsRef.current?.close();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setStatus('ended');
    onLeave?.();
  }, [send, onLeave]);

  const sendChat = useCallback(() => {
    const text = chatText.trim();
    if (!text) {
      return;
    }
    send({ type: 'chat', text });
    setMessages((m) => [...m, { mine: true, text }]);
    setChatText('');
  }, [chatText, send]);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Video visit</Text>
        <StatusBadge status={status} />
      </Group>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Group grow align="stretch" wrap="nowrap">
        <VideoTile label="You" videoRef={localVideoRef} muted />
        <VideoTile label="Patient" videoRef={remoteVideoRef} />
      </Group>

      <Group justify="center" gap="md">
        <Tooltip label={micOn ? 'Mute' : 'Unmute'}>
          <ActionIcon size="xl" radius="xl" variant={micOn ? 'light' : 'filled'} color={micOn ? 'gray' : 'red'} onClick={toggleMic}>
            {micOn ? <IconMicrophone size={20} /> : <IconMicrophoneOff size={20} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={camOn ? 'Turn camera off' : 'Turn camera on'}>
          <ActionIcon
            size="xl"
            radius="xl"
            variant={camOn ? 'light' : 'filled'}
            color={camOn ? 'gray' : 'red'}
            onClick={toggleCam}
            disabled={props.audioOnly}
          >
            {camOn ? <IconVideo size={20} /> : <IconVideoOff size={20} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Leave">
          <ActionIcon size="xl" radius="xl" variant="filled" color="red" onClick={hangUp}>
            <IconPhoneOff size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider label="Chat" labelPosition="center" />
      <ScrollArea h={140} type="auto">
        <Stack gap={4}>
          {messages.length === 0 && (
            <Text size="xs" c="dimmed" ta="center">
              No messages yet
            </Text>
          )}
          {messages.map((m, i) => (
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
          value={chatText}
          onChange={(e) => setChatText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              sendChat();
            }
          }}
        />
        <ActionIcon size="lg" variant="filled" onClick={sendChat} aria-label="Send message">
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
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
}): JSX.Element {
  return (
    <Paper withBorder radius="md" pos="relative" style={{ overflow: 'hidden', aspectRatio: '4 / 3', background: '#000' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <Badge pos="absolute" bottom={8} left={8} variant="filled" color="dark">
        {label}
      </Badge>
    </Paper>
  );
}

function StatusBadge({ status }: { status: Status }): JSX.Element {
  const map: Record<Status, { color: string; label: string }> = {
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
