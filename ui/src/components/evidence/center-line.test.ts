import { describe, expect, it } from 'vitest';
import { centeredTop, centerLine } from './center-line.ts';

const rect = (top: number, height: number) => () => ({ top, height }) as DOMRect;

// P7-F6: stepping to a match must scroll the log's box and nothing around it: scrollIntoView moved
// the sheet too, and the search field and its count left the screen.
describe('centering a line in the log box', () => {
  it('puts the line in the middle of the box, from where the box is scrolled to', () => {
    const box = { scrollTop: 100, clientHeight: 300, getBoundingClientRect: rect(50, 300) };
    const line = { getBoundingClientRect: rect(450, 20) };
    // The line sits 400 below the box's top: 100 + 400 - (300 - 20) / 2
    expect(centeredTop(box, line)).toBe(360);
  });

  it('scrolls the box alone, and never above its top', () => {
    const box = { scrollTop: 0, clientHeight: 300, getBoundingClientRect: rect(50, 300) };
    centerLine(box, { getBoundingClientRect: rect(60, 20) });
    expect(box.scrollTop).toBe(0);
    centerLine(box, { getBoundingClientRect: rect(450, 20) });
    expect(box.scrollTop).toBe(260);
  });
});
