export interface SlotGenerationInput {
  date: string;
  durationMinutes: number;
  opensAt: string | null;
  closesAt: string | null;
  now?: Date;
  gridMinutes?: number;
}

function parseUtcTime(date: string, time: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error('Working hours must use HH:mm UTC');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Working hours are invalid');
  const result = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== date) {
    throw new Error('Date must use YYYY-MM-DD');
  }
  return result;
}

export function generateSlots(input: SlotGenerationInput): Date[] {
  const { date, durationMinutes, opensAt, closesAt, now = new Date() } = input;
  const gridMinutes = input.gridMinutes ?? durationMinutes;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1)
    throw new Error('Duration must be positive');
  if (!Number.isInteger(gridMinutes) || gridMinutes < 1) throw new Error('Grid must be positive');
  if (!opensAt || !closesAt) return [];

  const opening = parseUtcTime(date, opensAt).getTime();
  const closing = parseUtcTime(date, closesAt).getTime();
  if (closing <= opening) throw new Error('Closing time must follow opening time');

  const slots: Date[] = [];
  const durationMs = durationMinutes * 60_000;
  const stepMs = gridMinutes * 60_000;
  for (let start = opening; start + durationMs <= closing; start += stepMs) {
    if (start > now.getTime()) slots.push(new Date(start));
  }
  return slots;
}
