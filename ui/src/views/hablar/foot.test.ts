// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { footOf } from './HablarView.tsx';

// Field study 5 (D2): on a phone on its side the thread is a window of about 60 px. Opened at its
// very end, a question taller than that showed its last lines and had lost its first: it looked cut
// at the top. The foot is where the newest block's top shows when it does not fit.

// A box and the turns in it, with the geometry a browser would give (happy-dom lays nothing out).
function thread(o: { box: number; scroll: number; turns: { top: number; height: number }[] }) {
  const box = document.createElement('div');
  const lanes = document.createElement('div');
  lanes.className = 'hb-lanes';
  box.append(lanes);
  Object.defineProperty(box, 'scrollHeight', { value: o.scroll });
  Object.defineProperty(box, 'clientHeight', { value: o.box });
  Object.defineProperty(box, 'scrollTop', { value: 0, writable: true });
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  for (const { top, height } of o.turns) {
    const turn = document.createElement('section');
    turn.className = 'hb-turn';
    Object.defineProperty(turn, 'offsetHeight', { value: height });
    turn.getBoundingClientRect = () => ({ top }) as DOMRect;
    lanes.append(turn);
  }
  return box;
}

describe('where the foot of the thread is', () => {
  it('is its very end while the newest block fits the box', () => {
    const box = thread({
      box: 300,
      scroll: 900,
      turns: [
        { top: 100, height: 400 },
        { top: 600, height: 280 },
      ],
    });
    expect(footOf(box)).toBe(900);
  });

  it('is the top of the newest block when it is taller than the box, with a little air above it', () => {
    const box = thread({
      box: 80,
      scroll: 900,
      turns: [
        { top: 100, height: 400 },
        { top: 560, height: 320 },
      ],
    });
    expect(footOf(box)).toBe(544);
  });

  it('never goes past the end, nor before the start', () => {
    expect(footOf(thread({ box: 80, scroll: 900, turns: [{ top: 5, height: 300 }] }))).toBe(0);
    expect(footOf(thread({ box: 300, scroll: 120, turns: [] }))).toBe(120);
  });
});
