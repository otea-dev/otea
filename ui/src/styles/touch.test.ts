import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Field study s-final (D-f9f30b, D-5d1947, D-46fe30, D-d251b3): text no smaller than the scale's
// minimum (11 px), controls that decide or open something 44 px tall on a finger, and 8 px between
// two controls that do different things.

const dir = new URL('./', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, dir), 'utf8').replace(/\r/g, '');
// Studio is its own authoring surface (the board editor's drawings); the rest is read by everyone.
const sheets = readdirSync(dir).filter((f) => f.endsWith('.css') && !f.startsWith('studio'));

describe('the type scale’s minimum', () => {
  it('has no text under 11 px in the sheets a person reads', () => {
    const small: string[] = [];
    for (const file of [...sheets.map((f) => `./${f}`), '../kit/kit.css']) {
      for (const [n, line] of read(file).split('\n').entries()) {
        const m = line.match(
          /font(?:-size)?:\s*(?:[a-z]+\s+)?(?:\d{3}\s+)?(?:italic\s+)?([\d.]+)px/,
        );
        if (m && Number(m[1]) < 11) small.push(`${file}:${n + 1} ${line.trim()}`);
      }
    }
    expect(small).toEqual([]);
  });
});

// The declarations of the first rule that opens with this selector.
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};
const gap = (css: string, selector: string): number =>
  Number(rule(css, selector).match(/\bgap:\s*(\d+)px/)?.[1] ?? 0);

describe('the space between controls', () => {
  const hablar = read('./hablar.css');
  it('keeps the options, chips, suggestions and tabs 8 px or more apart', () => {
    for (const selector of ['.hb-opts', '.hb-branch', '.hb-suggs', '.hb-tabs'])
      expect(gap(hablar, selector), selector).toBeGreaterThanOrEqual(8);
    expect(gap(read('./touch.css'), '.opts.stack')).toBeGreaterThanOrEqual(8);
  });
});

describe('the touch targets', () => {
  const touch = read('./touch.css');
  const phone = touch.slice(touch.indexOf('@media (max-width: 720px), (pointer: coarse)'));
  it('makes the controls named by the study 44 px or more on a finger', () => {
    for (const selector of ['.hb-sugg', '.hb-tabs button', '.hb-te-head', '.st-toggle']) {
      expect(phone, selector).toContain(selector);
    }
    expect(phone).toMatch(/\.hb-dx\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(phone).toMatch(/\.opts \.opt\s*\{[^}]*min-height:\s*44px/);
    expect(phone).toMatch(/\.hb-sugg,[^{]*\{[^}]*min-height:\s*44px/);
  });
});
