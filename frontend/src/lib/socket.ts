/**
 * Socket.io client singleton.
 * The socket connects to /socket.io which nginx proxies to the backend.
 * Supports WebSocket with polling fallback.
 */

import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types';

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
