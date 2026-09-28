export type Service = {
  _id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
};
export type Slot = { startTime: string; status: 'AVAILABLE' | 'PENDING' | 'CONFIRMED' };
export type Booking = {
  _id: string;
  serviceName: string;
  amount: number;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  expiresAt: string;
};
