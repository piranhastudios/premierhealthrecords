// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RawData, WebSocket } from 'ws';
import { globalLogger } from '../logger';
import { publish } from '../pubsub';
import { getPubSubRedisSubscriber } from '../redis';

/**
 * WebRTC telemedicine signaling.
 *
 * This is a thin, bandwidth-light relay: media flows peer-to-peer (optimised for
 * low-bandwidth links via the client), and the server only brokers the SDP/ICE
 * handshake. Rooms are keyed to a FHIR Appointment/Encounter id and brokered over
 * Redis pub/sub so two peers connected to different server replicas still reach
 * each other. The relay never inspects payloads beyond routing.
 *
 * Protocol (JSON text frames):
 * - Client -> server first frame: `{ "type": "join", "room": "<appointmentId>" }`
 * - Any later frame is relayed verbatim to the other peer(s) in the room.
 * - Server -> client: the peer's relayed frames, plus `{ "type": "peer-joined" }`
 *   when another peer enters (the trigger for the existing peer to make an offer).
 */
export async function handleTelehealthConnection(socket: WebSocket): Promise<void> {
  const connectionId = randomUUID();
  const redisSubscriber = getPubSubRedisSubscriber();
  let channel: string | undefined;

  // Forward messages from the room channel to this socket, skipping our own.
  redisSubscriber.on('message', (_ch: string, message: string) => {
    try {
      const envelope = JSON.parse(message) as { sender: string; payload: unknown };
      if (envelope.sender !== connectionId) {
        socket.send(JSON.stringify(envelope.payload), { binary: false });
      }
    } catch (err) {
      globalLogger.error('[telehealth] Failed to relay message', { error: err });
    }
  });

  const relay = async (payload: unknown): Promise<void> => {
    if (!channel) {
      return;
    }
    await publish(channel, JSON.stringify({ sender: connectionId, payload }));
  };

  socket.on(
    'message',
    AsyncLocalStorage.bind(async (data: RawData) => {
      let msg: any;
      try {
        msg = JSON.parse((data as Buffer).toString());
      } catch {
        return; // ignore non-JSON frames
      }

      if (msg?.type === 'join') {
        const room = String(msg.room ?? '').trim();
        if (!room) {
          socket.send(JSON.stringify({ type: 'error', message: 'Missing room' }));
          return;
        }
        if (channel) {
          return; // already joined
        }
        channel = `telehealth:${room}`;
        await redisSubscriber.subscribe(channel);
        // Tell any existing peer that we arrived, so it initiates the offer.
        await relay({ type: 'peer-joined' });
        return;
      }

      // All other frames (offer/answer/ice/bye) are relayed to the peer.
      await relay(msg);
    })
  );

  socket.on('close', () => {
    relay({ type: 'peer-left' }).catch(() => undefined);
    redisSubscriber.disconnect();
  });
}
