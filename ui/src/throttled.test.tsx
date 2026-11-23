// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './hooks.ts';
import './test-dom.tsx';

// The picker's read of every project runs on each change of the items; a burst asks once.

let shown = -1;
function Probe({ value }: { value: number }) {
  shown = useThrottled(value, 5_000);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useThrottled', () => {
  it('lets the first change through and holds a burst after it to one, the last', () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    const render = (value: number) => act(() => root.render(createElement(Probe, { value })));
    const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

    render(0);
    expect(shown).toBe(0);

    // The first change goes through at once.
    render(1);
    pass(0);
    expect(shown).toBe(1);

    // A burst after it waits out the window and lands as its last value, never the ones between.
    pass(1_000);
    render(2);
    pass(1_000);
    render(3);
    pass(2_900);
    expect(shown).toBe(1);
    pass(200);
    expect(shown).toBe(3);

    act(() => root.unmount());
  });
});
