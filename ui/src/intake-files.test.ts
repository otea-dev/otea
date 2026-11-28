import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from './i18n/i18n.ts';
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  rolesFor,
  shownFileName,
  sizeLabel,
  tooLarge,
  withFiles,
} from './intake-files.ts';
import type { Layout, LayoutEntry, TypeView } from './types.ts';

const EMPTY: Layout = {
  header: [],
  evidence: [],
  body: [],
  side: [],
  row: [],
  phone: [],
  intake: [],
};

const typeWith = (evidence: LayoutEntry[]): TypeView => ({
  name: 'bug',
  label: 'Bug',
  initial: 'open',
  states: [],
  fields: [],
  layout: { ...EMPTY, evidence },
});

const file = (name: string, size = 10) => ({ name, size }) as File;

afterEach(() => setLanguage('en'));

// E1: Chrome's camera names a photo by a long number («1732717234567.jpg»); the chip under the
// box said that. A name with words of its own is the person's, and stays.
describe('a file name as the chips show it', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 27, h, m).getTime();

  it('reads a camera’s number as a photo at its time', () => {
    setLanguage('es');
    expect(shownFileName('1732717234567.jpg', at(14, 32))).toBe(
      `Foto ${new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(1732717234567)}`,
    );
    expect(shownFileName('20261127_143210.jpg', at(14, 32))).toBe('Foto 14:32');
    expect(shownFileName('image.jpg', at(9, 5))).toBe('Foto 09:05');
    setLanguage('en');
    expect(shownFileName('PXL_20261127_143210123.jpg', at(14, 32))).toBe('Photo 14:32');
  });

  it('says only Foto when it does not know when', () => {
    setLanguage('es');
    expect(shownFileName('20261127143210.png', 0)).toBe('Foto');
  });

  it('keeps a name that says something, and calls a numbered document a file', () => {
    setLanguage('es');
    expect(shownFileName('boton-gris.png', at(14, 32))).toBe('boton-gris.png');
    expect(shownFileName('informe 2026.pdf', at(14, 32))).toBe('informe 2026.pdf');
    expect(shownFileName('20261127143210.mp4', at(14, 32))).toBe('Archivo 14:32');
  });
});

describe('intake files', () => {
  it('offers every role to a type without evidence modules', () => {
    expect(rolesFor(typeWith([]))).toEqual(['single', 'before', 'after']);
  });

  it('offers a before and an after to a compare, and single to every other module', () => {
    const compare: LayoutEntry = { module: 'images', id: 'pair', variant: 'compare' };
    const log: LayoutEntry = { module: 'log', id: 'log' };

    expect(rolesFor(typeWith([compare]))).toEqual(['before', 'after']);
    expect(rolesFor(typeWith([log]))).toEqual(['single']);
    expect(rolesFor(typeWith([compare, log]))).toEqual(['single', 'before', 'after']);
  });

  it('offers a file only the roles of the modules that take it', () => {
    const compare: LayoutEntry = { module: 'images', id: 'pair', variant: 'compare' };
    const log: LayoutEntry = { module: 'log', id: 'log' };
    const shots: LayoutEntry = { module: 'images', id: 'shots', variant: 'gallery' };

    // A photo on a board whose only image module compares: a before or an after, never single.
    expect(rolesFor(typeWith([compare, log]), 'foto.jpg')).toEqual(['before', 'after']);
    expect(rolesFor(typeWith([compare, log]), 'salida.log')).toEqual(['single']);
    expect(rolesFor(typeWith([compare, shots]), 'foto.jpg')).toEqual(['single', 'before', 'after']);
    // Nothing takes it: every role, and the server says why.
    expect(rolesFor(typeWith([log]), 'foto.jpg')).toEqual(['single']);
  });

  it('adds files up to the limit, each with its own key', () => {
    let next = 0;
    const key = () => `k${++next}`;
    const many = Array.from({ length: MAX_FILES + 2 }, (_, at) => file(`${at}.log`));

    const drafts = withFiles([], many, 'single', key);

    expect(drafts).toHaveLength(MAX_FILES);
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(MAX_FILES);
    expect(withFiles(drafts, [file('more.log')], 'single', key)).toHaveLength(MAX_FILES);
  });

  it('tells a file over the evidence limit and words sizes', () => {
    expect(tooLarge(file('big.mp4', MAX_FILE_BYTES + 1))).toBe(true);
    expect(tooLarge(file('ok.mp4', MAX_FILE_BYTES))).toBe(false);
    expect(sizeLabel(300)).toBe('1 KB');
    expect(sizeLabel(1.8 * 1024 * 1024)).toBe('1.8 MB');
  });
});
