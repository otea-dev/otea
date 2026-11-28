// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { footOf } from './HablarView.tsx';

// Field study 5 (D2): on a phone on its side the thread is a window of about 60 px. Opened at its
// very end, a question taller than that showed its last lines and had lost its first: it looked cut
// at the top. The foot is where the newest block's top shows when it does not fit.

// A box and the turns in it, with the geometry a browser would give (happy-dom lays nothing out).
function thread(o: {
  box: number;
  scroll: number;
  turns: { top: number; height: number; k?: string }[];
}) {
  const box = document.createElement('div');
  const lanes = document.createElement('div');
  lanes.className = 'hb-lanes';
  box.append(lanes);
  Object.defineProperty(box, 'scrollHeight', { value: o.scroll });
  Object.defineProperty(box, 'clientHeight', { value: o.box });
  Object.defineProperty(box, 'scrollTop', { value: 0, writable: true });
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  for (const { top, height, k } of o.turns) {
    const turn = document.createElement('section');
    turn.className = 'hb-turn';
    if (k) turn.dataset.k = k;
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

  // Field study 6 (D-741efa): on a phone an open question taller than the box held the view at its
  // top, so a message sent, and the reply after it, were written above the fold and never seen.
  it('keeps the newest message in sight when the questions waiting at the foot do not fit', () => {
    const box = thread({
      box: 400,
      scroll: 1300,
      turns: [
        { top: 100, height: 200, k: 'm:1' },
        { top: 400, height: 120, k: 'm:2' },
        { top: 536, height: 700, k: 'asks' },
      ],
    });
    const to = footOf(box);
    // The message's whole body is on the page, and the card's first lines peek in under it.
    expect(to).toBeLessThanOrEqual(400);
    expect(to + 400).toBeGreaterThanOrEqual(520);
    expect(to + 400).toBeLessThan(536 + 700);
  });

  it('shows the top of a message taller than the box, a question below it or not', () => {
    const box = thread({
      box: 200,
      scroll: 1300,
      turns: [
        { top: 400, height: 500, k: 'm:2' },
        { top: 916, height: 360, k: 'note-asks' },
      ],
    });
    expect(footOf(box)).toBe(384);
  });

  it('shows the top of a question when it is all there is', () => {
    const box = thread({
      box: 80,
      scroll: 900,
      turns: [{ top: 560, height: 320, k: 'asks' }],
    });
    expect(footOf(box)).toBe(544);
  });

  it('is the very end when the questions fit with the message', () => {
    const box = thread({
      box: 400,
      scroll: 700,
      turns: [
        { top: 100, height: 200, k: 'm:2' },
        { top: 316, height: 300, k: 'asks' },
      ],
    });
    expect(footOf(box)).toBe(700);
  });

  it('never goes past the end, nor before the start', () => {
    expect(footOf(thread({ box: 80, scroll: 900, turns: [{ top: 5, height: 300 }] }))).toBe(0);
    expect(footOf(thread({ box: 300, scroll: 120, turns: [] }))).toBe(120);
  });
});
