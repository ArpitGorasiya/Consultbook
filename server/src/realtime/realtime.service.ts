import type { Server } from 'socket.io';

let io: Server | undefined;

export function configureRealtime(server: Server): void {
  io = server;
}

export function emitToRoom(room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
}

export function emitSlotUpdate(
  serviceId: string,
  date: string,
  event: string,
  payload: unknown,
): void {
  emitToRoom(`slots:${serviceId}:${date}`, event, payload);
}
