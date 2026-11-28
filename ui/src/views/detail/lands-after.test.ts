import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { landsAfterText } from './lands-after.ts';

// s-real2 D-27f992: an approved item that waits for another to land showed a red box in English, in
// the agents' words, on a Spanish desk. The page says it in its own language.
describe('why an approved item waits to land', () => {
  afterEach(() => setLanguage('en'));

  it('is said in the language of the screen, naming the item that goes first', () => {
    const waits = { first: 'CAM-3', text: 'CAM-12 waits to land in main: …' };
    setLanguage('es');
    const es = landsAfterText(waits);
    expect(es).toContain('CAM-3');
    expect(es).not.toContain('waits to land');
    setLanguage('en');
    expect(landsAfterText(waits)).toContain('CAM-3');
  });

  it('says that two changes of the same files go one after the other', () => {
    setLanguage('es');
    const same = landsAfterText({ first: 'CAM-3', text: 'x', overlap: true });
    const other = landsAfterText({ first: 'CAM-3', text: 'x' });
    expect(same).not.toBe(other);
    expect(same).toMatch(/mismos archivos/);
  });

  it('says nothing when it waits for none', () => {
    expect(landsAfterText(undefined)).toBeUndefined();
  });
});
