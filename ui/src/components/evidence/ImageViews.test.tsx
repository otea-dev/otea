import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import type { Evidence } from '../../types.ts';
import { ImageCompare, ImageCompares, ImageGallery } from './ImageViews.tsx';
import { ItemReview } from './item-evidence.ts';

const image = (id: number): Evidence => ({
  id,
  itemId: 'CRI-1',
  role: 'single',
  module: 'eart',
  kind: 'image',
  filename: `ronda-${id}.png`,
  contentType: 'image/png',
  size: 1,
  sha256: '',
  caption: null,
  createdAt: `2026-01-0${id}T00:00:00Z`,
  actor: { kind: 'agent', name: 'brush' },
  channel: 'cli',
});

// The blind slider was «Divisor entre antes y después» to a screen reader (P5-R2-3).
describe('ImageCompare, blind', () => {
  it('names its divider between A and B, never before and after', () => {
    setLanguage('es');
    const a = { ...image(1), role: 'before' as const };
    const b = { ...image(2), role: 'after' as const };
    const html = renderToStaticMarkup(<ImageCompare evidence={[a, b]} blind initial="slider" />);
    expect(html).toContain('aria-label="Divisor entre A y B"');
    expect(html).not.toMatch(/antes|después/);
    setLanguage('en');
  });
});

// H3 (field study 4, U7): a module with shots at two sizes drew one compare of whichever pair came
// last. Each viewport gets its own compare, named, the phone first, and never a desktop shot
// against a phone shot.
describe('ImageCompares, by viewport', () => {
  const shot = (id: number, filename: string, role: 'before' | 'after'): Evidence => ({
    ...image(id),
    role,
    filename,
  });
  const files = [
    shot(1, 'antes-1280.png', 'before'),
    shot(2, 'despues-1280.png', 'after'),
    shot(3, 'antes-390.png', 'before'),
    shot(4, 'despues-390.png', 'after'),
  ];

  it('draws one compare per viewport, each with its own two files', () => {
    const html = renderToStaticMarkup(<ImageCompares evidence={files} />);
    const blocks = html.split('class="ev-compare"').slice(1);
    expect(blocks).toHaveLength(2);
    const names = (block: string) =>
      [...block.matchAll(/alt="[^"]*?([a-z]+-\d+\.png)"/g)].map((m) => m[1]);
    expect(new Set(names(blocks[0] ?? ''))).toEqual(new Set(['antes-390.png', 'despues-390.png']));
    expect(new Set(names(blocks[1] ?? ''))).toEqual(
      new Set(['antes-1280.png', 'despues-1280.png']),
    );
    // Named in words, the phone first.
    expect(html.indexOf('Phone')).toBeGreaterThan(-1);
    expect(html.indexOf('Phone')).toBeLessThan(html.indexOf('Desktop'));
  });

  it('is one plain compare, with no viewport heading, when the shots name one viewport', () => {
    const html = renderToStaticMarkup(<ImageCompares evidence={files.slice(2)} />);
    expect(html.split('class="ev-compare"')).toHaveLength(2);
    expect(html).not.toContain('Phone');
  });
});

// s-real D-5ccd20 / D-fdfd69: four cases in one part drew one compare of whichever before and after
// came last, as a slider whose labels sat over the picture.
describe('ImageCompares, by case', () => {
  const shot = (id: number, filename: string, role: 'before' | 'after'): Evidence => ({
    ...image(id),
    role,
    filename,
  });
  const files = [
    shot(1, 'antes-al-abrir.png', 'before'),
    shot(2, 'despues-al-abrir.png', 'after'),
    shot(3, 'antes-no-existe.png', 'before'),
    shot(4, 'despues-no-existe.png', 'after'),
  ];

  it('draws one compare for each case, each with its own two files, each file once', () => {
    const html = renderToStaticMarkup(<ImageCompares evidence={files} />);
    const compares = html.split('class="ev-compare"').slice(1);
    expect(compares).toHaveLength(2);
    const names = (block: string) =>
      [...block.matchAll(/alt="[^"]*?([a-z-]+\.png)"/g)].map((m) => m[1]);
    expect(names(compares[0] ?? '')).toEqual(['antes-al-abrir.png', 'despues-al-abrir.png']);
    expect(names(compares[1] ?? '')).toEqual(['antes-no-existe.png', 'despues-no-existe.png']);
  });

  it('opens side by side, with the labels outside the picture, and keeps the slider as an option', () => {
    const html = renderToStaticMarkup(<ImageCompare evidence={files.slice(0, 2)} />);
    expect(html).toContain('data-mode="side"');
    expect(html).not.toContain('role="slider"');
    expect(html).toContain('slider');
    // A label inside a picture's well would cover what changed.
    for (const stage of html.split('class="ev-stage well"').slice(1)) {
      expect(stage.split('</figure>')[0]).not.toContain('ev-tag');
    }
  });
});

describe('ImageGallery', () => {
  it('opens on the newest file, the latest round’s, and keeps the oldest first in the strip', () => {
    const html = renderToStaticMarkup(
      <ImageGallery evidence={[image(1), image(2), image(3)]} label="Arte" />,
    );
    expect(html).toContain('3 / 3');
    expect(html).toMatch(/class="ev-img ev-set"[^>]*alt="ronda-3.png"/);
    expect(html.indexOf('ronda-1.png')).toBeLessThan(html.indexOf('ronda-2.png'));
    expect(html).toMatch(/aria-current="true" aria-label="[^"]*ronda-3.png"/);
  });
});

// P5-5: on the desk the gallery's thumbnails said nothing of the round each picture came in.
describe('ImageGallery on a reviewed item', () => {
  it('names the round of each thumbnail and of the picture shown', () => {
    setLanguage('es');
    const roundOf = new Map([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
    const html = renderToStaticMarkup(
      <ItemReview.Provider value={{ roundOf }}>
        <ImageGallery evidence={[image(1), image(2), image(3)]} label="Arte" />
      </ItemReview.Provider>,
    );
    const rounds = [...html.matchAll(/class="ev-thumb-round">ronda (\d)</g)].map((m) => m[1]);
    expect(rounds).toEqual(['1', '1', '2']);
    expect(html).toMatch(/class="ev-tag r"[^>]*>3 \/ 3 · ronda 2</);
    setLanguage('en');
  });

  it('says no round off a review', () => {
    const html = renderToStaticMarkup(
      <ImageGallery evidence={[image(1), image(2)]} label="Arte" />,
    );
    expect(html).not.toContain('ev-thumb-round');
  });
});
