import { describe, expect, it } from 'vitest';
import { OteaError } from '../core/errors.ts';
import { findVersion } from '../store/boards.ts';
import {
  createBoard,
  getBoardRecord,
  publishBoard,
  saveDraft,
  syncBoardPresets,
} from './boards.ts';
import type { Context } from './context.ts';
import { createItem, getItem } from './items.ts';
import { handoffItem } from './next.ts';
import { inLanguage } from './reading-lang.ts';
import { memoryContext } from './testing.ts';

// A board stores keys and the words its person wrote, so the language on screen says the rest: a
// board made in Spanish reads in Spanish on a Spanish desk, in English on an English one, and
// switching changes nothing stored.

const you = { kind: 'human' as const, name: 'fede' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 12, 9, 0, tick++)).toISOString();

// A board made in Spanish from a template, published; and what its version row holds.
function spanishBoard() {
  const ctx = memoryContext();
  const record = createBoard(ctx, { name: 'Errores', lang: 'es', template: 'bug-reports' }, now);
  publishBoard(ctx, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } }, now);
  return { ctx, id: record.id };
}

// An item of the board, with the one field its form asks, found by its Spanish name.
function createFaro(ctx: Context, board: string) {
  const parts = inLanguage('es', () => getBoardRecord(ctx, board).live?.definition.parts ?? {});
  const reported = Object.values(parts).find(({ name }) => name === 'Lo que reportaron');
  return createItem(
    ctx,
    {
      collection: 'Errores',
      title: 'Faro',
      fields: { [reported?.id ?? 'missing']: 'Se cae' },
      actor: you,
    },
    now,
  );
}

const rowOf = (ctx: Context, id: string) => findVersion(ctx.db, id, 1)?.definition ?? '';

const readIn = (ctx: Context, id: string, lang: 'en' | 'es') =>
  inLanguage(lang, () => {
    const live = getBoardRecord(ctx, id).live?.definition;
    if (!live) throw new Error('the board is not live');
    return live;
  });

describe('a board made in Spanish', () => {
  it('shows its fields, steps and options in Spanish on a Spanish desk, and in English on an English one', () => {
    const { ctx, id } = spanishBoard();
    const spanish = readIn(ctx, id, 'es');
    const english = readIn(ctx, id, 'en');

    expect(spanish.title).toBe('Título');
    expect(spanish.steps.map(({ name }) => name)).toEqual([
      'Completar',
      'Triar',
      'Arreglar',
      'Integrar',
    ]);
    expect(Object.values(spanish.parts).map(({ name }) => name)).toContain('Lo que reportaron');
    expect(english.title).toBe('Title');
    expect(english.steps.map(({ name }) => name)).toEqual(['Complete', 'Triage', 'Fix', 'Land']);
    expect(Object.values(english.parts).map(({ name }) => name)).toContain('What they reported');
    // Whole, never half and half: no Spanish word of the template is left on the English desk
    // (its snapshot, which holds every language, is not what the desk shows).
    const { snapshot: _kept, ...shown } = english;
    expect(JSON.stringify(shown)).not.toMatch(/Completar|Triar|Arreglar|Lo que|Título|Gravedad/);
  });

  // A desk that opens a draft in English, changes one word and saves it, then another desk in
  // Spanish reads it: the change is there, in both, and nothing else was lost or mixed.
  it('survives being read in the other language, edited and saved', () => {
    const ctx = memoryContext();
    const record = createBoard(ctx, { name: 'Errores', lang: 'es', template: 'bug-reports' }, now);
    const draftIn = (lang: 'en' | 'es') =>
      inLanguage(lang, () => {
        const draft = getBoardRecord(ctx, record.id).draft?.definition;
        if (!draft) throw new Error('no draft');
        return draft;
      });
    const spanishBefore = draftIn('es');

    // The English desk edits the first step's name and saves what it holds.
    const english = draftIn('en');
    const [first] = english.steps;
    if (!first) throw new Error('no step');
    first.name = 'Look into it';
    inLanguage('en', () =>
      saveDraft(ctx, record.id, { definition: english, baseVersion: null }, now),
    );

    const steps = (lang: 'en' | 'es') => draftIn(lang).steps.map(({ name }) => name);
    expect(steps('en')).toEqual(['Look into it', 'Triage', 'Fix', 'Land']);
    expect(steps('es')).toEqual(['Look into it', 'Triar', 'Arreglar', 'Integrar']);
    // Everything else reads as it did in Spanish before the English desk touched it.
    const spanishAfter = draftIn('es');
    expect({ ...spanishAfter, steps: [], snapshot: undefined }).toEqual({
      ...spanishBefore,
      steps: [],
      snapshot: undefined,
    });
    expect(spanishAfter.steps.slice(1)).toEqual(spanishBefore.steps.slice(1));
    // And it publishes, and the version reads in both languages.
    publishBoard(ctx, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } }, now);
    expect(readIn(ctx, record.id, 'en').steps[0]?.name).toBe('Look into it');
    expect(readIn(ctx, record.id, 'es').steps[1]?.name).toBe('Triar');
  });

  it('answers two requests in different languages at once, each in its own', async () => {
    const { ctx, id } = spanishBoard();
    const tickOnce = () => new Promise((resolve) => setTimeout(resolve, 1));
    const request = (lang: 'en' | 'es') =>
      inLanguage(lang, async () => {
        const seen: string[] = [];
        for (let round = 0; round < 3; round++) {
          syncBoardPresets(ctx);
          const label = Object.values(ctx.presets.presets.get(id)?.fields ?? {}).map(
            (field) => field.label,
          );
          seen.push(
            getBoardRecord(ctx, id).live?.definition.steps[0]?.name ?? '',
            label.includes('Lo que reportaron')
              ? 'es'
              : label.includes('What they reported')
                ? 'en'
                : '?',
          );
          await tickOnce();
        }
        return seen;
      });

    const [spanish, english] = await Promise.all([request('es'), request('en')]);
    expect(new Set(spanish)).toEqual(new Set(['Completar', 'es']));
    expect(new Set(english)).toEqual(new Set(['Complete', 'en']));
  });

  it('is read with no language in the one it was made in, whatever the desk used last', () => {
    const { ctx, id } = spanishBoard();
    readIn(ctx, id, 'en');
    expect(getBoardRecord(ctx, id).live?.definition.steps[0]?.name).toBe('Completar');
    expect(rowOf(ctx, id)).toContain('Arreglar');
  });

  it('keeps an item whole across the switch: same state, same fields, said in the language read', () => {
    const { ctx, id } = spanishBoard();
    const item = inLanguage('es', () => createFaro(ctx, id));
    // What the item page labels its fields with: the board compiled for the language on screen.
    const seen = (lang: 'en' | 'es') =>
      inLanguage(lang, () => {
        syncBoardPresets(ctx);
        const labels = Object.values(ctx.presets.presets.get(id)?.fields ?? {}).map(
          (field) => field.label,
        );
        return { state: getItem(ctx, item.id).state, fields: getItem(ctx, item.id).fields, labels };
      });
    const spanish = seen('es');
    const english = seen('en');

    expect(spanish.labels).toContain('Lo que reportaron');
    expect(english.labels).toContain('What they reported');
    expect(english.labels).not.toContain('Lo que reportaron');
    // The item is the same: its state and what was filled in do not depend on the language.
    expect(english.state).toBe(spanish.state);
    expect(english.fields).toEqual(spanish.fields);
    expect(Object.values(english.fields)).toContain('Se cae');
  });

  it('words a refusal with the names of the language on screen', () => {
    const { ctx, id } = spanishBoard();
    const item = createFaro(ctx, id);
    const refused = (lang: 'en' | 'es') =>
      inLanguage(lang, () => {
        try {
          handoffItem(ctx, { id: item.id, actor: you, channel: 'ui' }, now);
        } catch (error) {
          if (error instanceof OteaError) return error;
          throw error;
        }
        throw new Error('expected a refusal');
      });

    const spanish = JSON.stringify(refused('es').details);
    const english = JSON.stringify(refused('en').details);
    // What the person is told is missing is named as the board names it on the screen.
    expect(spanish).toContain('Cómo reproducirlo');
    expect(english).toContain('Steps to reproduce');
    expect(english).not.toContain('Cómo reproducirlo');
  });
});
