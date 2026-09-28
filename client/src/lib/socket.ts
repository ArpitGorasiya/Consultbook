import { io, type Socket } from 'socket.io-client';

export function connectSocket(token: string): Socket {
  return io(import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
}
