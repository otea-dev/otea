import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORT_QUERY } from './phone-media.ts';

// Field study 6 (u5): on a desk window of 1258x566 «Te toca ahora» held its rows open and the thread
// kept two or three lines, or none, so the answers in it could not be reached. A window short by
// height folds the strip and slims the heading, on a computer as on a phone.

const limit = (query: string) => Number(/max-height:\s*(\d+)px/.exec(query)?.[1]);

describe('a window that is short', () => {
  it('counts a desk window of 620 px as short, and a tall one not', () => {
    expect(limit(SHORT_QUERY)).toBeGreaterThanOrEqual(620);
    expect(limit(SHORT_QUERY)).toBeLessThan(800);
  });

  it('slims Hablar’s heading and gives the thread a floor for the same windows', () => {
    const css = readFileSync(new URL('./hablar.css', import.meta.url), 'utf8');
    const px = limit(SHORT_QUERY);
    const block = css.slice(css.indexOf(`@media (min-width: 721px) and (max-height: ${px}px)`));
    expect(block, 'a desk rule by height').not.toBe('');
    expect(block).toMatch(/\.hb-chat\s*\{[^}]*min-height:\s*\d+px/);
    expect(block).toMatch(/\.hb-main > \.head \.dek[^{]*\{[^}]*display:\s*none/);
  });
});
