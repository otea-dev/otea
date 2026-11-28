import { describe, expect, it } from 'vitest';
import { clockText, timeText } from './time.ts';

// Field study 3: «lo tomó a las 06:19 UTC» when it was 07:19 for the person. The times of the
// texts stay UTC (one clock for every agent); the text that reaches the assistant says what the
// person's clock reads, so it can say times as they do.
describe('clockText', () => {
  const noon = Date.parse('2026-11-26T12:00:00Z');
  it.each([
    ['America/Argentina/Buenos_Aires', '09:00 (UTC-3, America/Argentina/Buenos_Aires)'],
    ['Europe/Madrid', '13:00 (UTC+1, Europe/Madrid)'],
    ['UTC', '12:00 (UTC, UTC)'],
    ['Asia/Kolkata', '17:30 (UTC+5:30, Asia/Kolkata)'],
  ])('reads %s as %s', (zone, text) => {
    expect(clockText(noon, zone)).toBe(text);
  });
});

describe('timeText', () => {
  // A timestamp reads as its UTC day and minute, named UTC, whatever its offset; other text stays.
  it.each([
    ['2026-11-12T10:04:59.999Z', '2026-11-12 10:04 UTC'],
    ['2026-11-12T23:30:00+02:00', '2026-11-12 21:30 UTC'],
    ['soon', 'soon'],
  ])('says %s as %s', (iso, text) => {
    expect(timeText(iso)).toBe(text);
  });
});
