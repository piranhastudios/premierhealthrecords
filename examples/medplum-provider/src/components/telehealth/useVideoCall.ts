// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { useMedplum } from '@medplum/react';
import type { RefObject } from 'react';
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

export type CallStatus = 'connecting' | 'waiting' | 'connected' | 'ended' | 'error';
export interface ChatMessage {
  mine: boolean;
  text: string;
}

export interface VideoCall {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  status: CallStatus;
  error?: string;
  micOn: boolean;
  camOn: boolean;
  audioOnly: boolean;
  messages: ChatMessage[];
  chatText: string;
  setChatText: (text: string) => void;
  toggleMic: () => void;
  toggleCam: () => void;
  hangUp: () => void;
  sendChat: () => void;
}

/**
 * WebRTC telemedicine call: media is peer-to-peer; only SDP/ICE (and text chat)
 * pass through the server's `/ws/telehealth` signaling relay. Video bitrate is
 * capped and audio-only is supported for low bandwidth. Presentation lives in the
 * consuming components (compact panel vs full-screen) so both share this logic.
 * @param roomId - Room id (an Appointment/Encounter id shared by both peers).
 * @param audioOnly - Start without video.
 * @param onLeave - Called when the local user hangs up.
 * @returns Refs, state and controls for a video call.
 */
export function useVideoCall(roomId: string, audioOnly: boolean, onLeave?: () => void): VideoCall {
  const medplum = useMedplum();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CallStatus>('connecting');
  const [error, setError] = useState<string>();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(!audioOnly);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');

  const send = useCallback((msg: unknown): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

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
          video: audioOnly ? false : VIDEO_CONSTRAINTS,
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
  }, [roomId, audioOnly, medplum, send, applyBitrateCap]);

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

  return {
    localVideoRef,
    remoteVideoRef,
    status,
    error,
    micOn,
    camOn,
    audioOnly,
    messages,
    chatText,
    setChatText,
    toggleMic,
    toggleCam,
    hangUp,
    sendChat,
  };
}
