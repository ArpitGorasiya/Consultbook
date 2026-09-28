import { generateSlots } from '../src/services/slots.service';

describe('generateSlots', () => {
  const base = {
    date: '2030-01-07',
    durationMinutes: 60,
    now: new Date('2030-01-06T00:00:00.000Z'),
  };

  it('generates back-to-back starts without including a slot that crosses closing time', () => {
    const slots = generateSlots({ ...base, opensAt: '10:00', closesAt: '12:00' });
    expect(slots.map((slot) => slot.toISOString())).toEqual([
      '2030-01-07T10:00:00.000Z',
      '2030-01-07T11:00:00.000Z',
    ]);
  });

  it('returns no slots on a day off', () => {
    expect(generateSlots({ ...base, opensAt: null, closesAt: null })).toEqual([]);
  });

  it('skips starts in the past and rejects malformed dates', () => {
    const slots = generateSlots({
      ...base,
      now: new Date('2030-01-07T10:30:00.000Z'),
      opensAt: '10:00',
      closesAt: '12:00',
    });
    expect(slots.map((slot) => slot.toISOString())).toEqual(['2030-01-07T11:00:00.000Z']);
    expect(() =>
      generateSlots({ ...base, date: 'not-a-date', opensAt: '10:00', closesAt: '12:00' }),
    ).toThrow();
  });
});
