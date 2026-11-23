import { afterEach, describe, expect, it } from 'vitest';
import { boardSpeech } from './board-words.ts';
import { setLanguage } from './i18n/i18n.ts';
import {
  fieldWord,
  keptStateWord,
  keyTitle,
  stateWord,
  typeWord,
  valueWord,
  valueWordIn,
} from './preset-words.ts';
import type { TypeView } from './types.ts';

const repoTask = {
  name: 'repo_task',
  label: 'Repo task',
  initial: 'proposed',
  states: [],
  fields: [],
  layout: { header: [], body: [], side: [], evidence: [], row: [], intake: [] },
  labels: {
    es: {
      label: 'Tarea de repo',
      states: { pr_review: 'revisión de PR' },
      fields: { branch: 'rama' },
      values: { severity: { high: 'alta' } },
    },
  },
} as unknown as TypeView;

afterEach(() => setLanguage('en'));

describe('preset words', () => {
  it('stay as the preset wrote them in English', () => {
    expect(stateWord(repoTask, 'pr_review')).toBe('pr_review');
    expect(typeWord(repoTask, 'repo_task')).toBe('Repo task');
    expect(fieldWord(repoTask, 'branch')).toBeUndefined();
  });

  it('take the preset’s Spanish labels in Spanish', () => {
    setLanguage('es');

    expect(stateWord(repoTask, 'pr_review')).toBe('revisión de PR');
    expect(typeWord(repoTask, 'repo_task')).toBe('Tarea de repo');
    expect(fieldWord(repoTask, 'branch')).toBe('rama');
  });

  it("say a field's value in the language on screen, or as written", () => {
    expect(valueWord(repoTask, 'severity', 'high')).toBe('high');
    setLanguage('es');
    expect(valueWord(repoTask, 'severity', 'high')).toBe('alta');
    expect(valueWord(repoTask, 'severity', 'low')).toBe('low');
    expect(valueWordIn([repoTask], 'severity', 'high')).toBe('alta');
  });

  it('say a checklist’s or multi choice’s list of ids by its names, an unknown id as written', () => {
    const board = {
      ...repoTask,
      labels: {
        en: { states: {}, fields: {}, values: { fsteps: { crig: 'Rig', cwalk: 'Trot' } } },
      },
    } as unknown as TypeView;

    expect(valueWord(board, 'fsteps', '["crig","cwalk","cgone"]')).toBe('Rig, Trot, cgone');
    expect(valueWord(board, 'fsteps', '[]')).toBe('');
    expect(valueWordIn([board], 'fsteps', '["cwalk"]')).toBe('Trot');
    expect(valueWord(board, 'fsteps', '[not json')).toBe('[not json');
    expect(valueWord(repoTask, 'notes', '["a"]')).toBe('["a"]');
  });

  it('fall back to the key for a type without labels, or while the type is unknown', () => {
    setLanguage('es');

    const { labels: _, ...unlabelled } = repoTask;
    expect(stateWord(unlabelled, 'pr_review')).toBe('pr_review');
    expect(stateWord(undefined, 'pr_review')).toBe('pr_review');
    expect(typeWord(undefined, 'repo_task')).toBe('repo_task');
  });

  it('keep the key at hand as a tooltip only where a label shows', () => {
    expect(keyTitle('revisión de PR', 'pr_review')).toBe('pr_review');
    expect(keyTitle('pr_review', 'pr_review')).toBeUndefined();
  });
});

describe('keptStateWord', () => {
  afterEach(() => setLanguage('en'));

  // A Spanish desk on an English board: Done, Dropped and a review read as the board's agent reads
  // them, not in the screen's language.
  it('says a kept state name in the board’s language, whatever the screen’s', () => {
    setLanguage('es');
    const english = boardSpeech({ lang: 'en', title: 'Title' });
    expect(keptStateWord('Done', english)).toBe('Done');
    expect(keptStateWord('Dropped', english)).toBe('Dropped');
    expect(keptStateWord('Dropped (Duplicate)', english)).toBe('Duplicate');
    expect(keptStateWord('Refine (in review)', english)).toBe('Refine (in review)');
    expect(keptStateWord('Refine (en revisión)', english)).toBe('Refine (in review)');
    expect(keptStateWord('Refine', english)).toBe('Refine');
    setLanguage('en');
    const spanish = boardSpeech({ lang: 'es', title: 'Título' });
    expect(keptStateWord('Done', spanish)).toBe('Hecho');
    expect(keptStateWord('Dropped', spanish)).toBe('Descartado');
    expect(keptStateWord('Refinar (in review)', spanish)).toBe('Refinar (en revisión)');
  });

  it('keeps a review as it was kept, and says Done and Dropped in the screen’s, when no board is at hand', () => {
    setLanguage('es');
    expect(keptStateWord('Refine (in review)')).toBe('Refine (in review)');
    expect(keptStateWord('Done')).toBe('Hecho');
    expect(keptStateWord('Dropped')).toBe('Descartado');
  });
});
