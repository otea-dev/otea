import { describe, expect, it } from 'vitest';
import { MISS_FOR_MS, missedLately, noteMiss } from './harness-miss.ts';

// Review of H2: a claim waited for the process listing every time it could not read the harness.
// A lookup that failed is remembered for a while, so the claims after it do not pay again.
describe('a harness lookup that failed is remembered for a while', () => {
  const cwd = `/work/${Math.random().toString(36).slice(2)}`;

  it('skips the lookup for the same agent and folder until the time is out', () => {
    expect(missedLately(cwd, 'ana')).toBe(false);

    noteMiss(cwd, 'ana');

    expect(missedLately(cwd, 'ana')).toBe(true);
    expect(missedLately(cwd, 'bea')).toBe(false);
    expect(missedLately(`${cwd}/other`, 'ana')).toBe(false);
    expect(missedLately(cwd, 'ana', Date.now() + MISS_FOR_MS + 1000)).toBe(false);
  });
});
