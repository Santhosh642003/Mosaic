/**
 * Socket.io client singleton.
 * The socket connects to /socket.io which nginx proxies to the backend.
 * Supports WebSocket with polling fallback.
 */

import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types';
import { useRoomStore } from '@/stores/roomStore';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(): AppSocket {
  const s = getSocket();
  if (!s.connected) {
    // Attach token so the server can read it on connect
    const token = localStorage.getItem('access_token');
    if (token) {
      s.auth = { token };
    }
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

/**
 * Join a room's socket channel, always supplying identity so the backend can
 * resolve the member. Authenticated users are matched by their JWT; guests
 * have no token, so we send their member id (from the store, falling back to
 * the value persisted at join time so it survives reloads).
 */
export function joinSocketRoom(code: string): void {
  const token = localStorage.getItem('access_token');
  const memberId =
    useRoomStore.getState().myMemberId ??
    localStorage.getItem(`mosaic_member_${code.toUpperCase()}`) ??
    undefined;
  emit('join_room', { code, token, memberId });
}

export function emit<Ev extends keyof ClientToServerEvents>(
  event: Ev,
  ...args: Parameters<ClientToServerEvents[Ev]>
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit(event, ...args);
  } else {
    // Queue after connect
    s.once('connect', () => s.emit(event, ...args));
    connectSocket();
  }
}
