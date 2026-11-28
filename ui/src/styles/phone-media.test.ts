import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { LANDSCAPE_PHONE, phoneByHeight, phoneMedia } from './phone-media.ts';

const run = (css: string) => postcss([phoneByHeight()]).process(css, { from: undefined }).css;

// E1: a phone on its side (844x390) is wider than 720 px, so it got the desk layout and Hablar's
// conversation kept no height. The sheets say `(max-width: 720px)` for the phone: the build adds
// the phone on its side to every one, and takes it out of the desk's `(min-width: 721px)`.
describe('the phone on its side', () => {
  it('is added to the phone’s media queries, whatever else the query says', () => {
    expect(phoneMedia('(max-width: 720px)')).toBe(`(max-width: 720px), ${LANDSCAPE_PHONE}`);
    expect(phoneMedia('(max-width: 720px) and (pointer: coarse)')).toBe(
      `(max-width: 720px) and (pointer: coarse), ${LANDSCAPE_PHONE} and (pointer: coarse)`,
    );
    expect(phoneMedia('(pointer: coarse), (max-width: 720px)')).toBe(
      `(pointer: coarse), (max-width: 720px), ${LANDSCAPE_PHONE}`,
    );
  });

  it('is taken out of the desk’s queries', () => {
    expect(phoneMedia('(min-width: 721px)')).toBe(
      `(min-width: 721px) and (not (${LANDSCAPE_PHONE}))`,
    );
    expect(phoneMedia('(max-width: 1100px) and (min-width: 721px)')).toBe(
      `(max-width: 1100px) and (min-width: 721px) and (not (${LANDSCAPE_PHONE}))`,
    );
  });

  it('leaves every other query, and a query it already changed, alone', () => {
    for (const same of [
      '(hover: hover)',
      '(min-width: 1441px)',
      '(max-width: 760px)',
      '(prefers-reduced-motion: reduce)',
      phoneMedia('(max-width: 720px)'),
    ])
      expect(phoneMedia(same)).toBe(same);
  });

  it('rewrites the media rules of a sheet, once, nested ones too', () => {
    const out = run(
      '@media (max-width: 720px) { .a { color: red } @media (hover: hover) { .b:hover { color: blue } } } @media (min-width: 721px) { .c { color: green } } @container detail (max-width: 720px) { .d { color: pink } }',
    );
    expect(out).toContain(`@media (max-width: 720px), ${LANDSCAPE_PHONE} {`);
    expect(out).toContain(`@media (min-width: 721px) and (not (${LANDSCAPE_PHONE})) {`);
    expect(out).toContain('@media (hover: hover) {');
    expect(out).toContain('@container detail (max-width: 720px) {');
    expect(out.split(LANDSCAPE_PHONE).length - 1).toBe(2);
  });
});
