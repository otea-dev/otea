// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { trackModality } from './input-modality.ts';

const root = () => document.documentElement;
let off: (() => void) | undefined;
afterEach(() => off?.());

const key = (name: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
const touch = () =>
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

describe('which hand was last on the page', () => {
  it('says the keys until a tap or a click, and the pointer from it until the next key', () => {
    off = trackModality(document);
    expect(root().getAttribute('data-input')).toBeNull();
    touch();
    expect(root().getAttribute('data-input')).toBe('pointer');
    key('Tab');
    expect(root().getAttribute('data-input')).toBe('key');
    touch();
    key('Escape');
    expect(root().getAttribute('data-input')).toBe('key');
  });

  it('is not moved by a modifier held on its own', () => {
    off = trackModality(document);
    touch();
    for (const modifier of ['Shift', 'Control', 'Alt', 'Meta']) key(modifier);
    expect(root().getAttribute('data-input')).toBe('pointer');
  });

  it('leaves the page as it found it when it stops', () => {
    off = trackModality(document);
    touch();
    off();
    expect(root().getAttribute('data-input')).toBeNull();
    touch();
    expect(root().getAttribute('data-input')).toBeNull();
  });
});
