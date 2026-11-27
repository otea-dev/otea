import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, GATHER_MS, type Notice, Planner } from './planner.ts';
import { bandejaSignalsOf, type NotifyFacts, signalsOf } from './signals.ts';
import { noticeText } from './text.ts';

// A 0.7 project may have a board whose prefix is B: its items are B-1, B-2, as a Bandeja note is B-1.
// A notice for B-n is the item's first (the question on the real item opens its page), and a
// question on a note of the same number still opens Hablar at the note: the two never take each
// other's place, link or tag.
const T0 = Date.parse('2026-11-14T10:00:00.000Z');

const itemAsks: NotifyFacts = {
  id: 'B-1',
  title: 'Fix the cache',
  state: 'in_progress',
  turn: 'human',
  lease: null,
  asks: { question: 1, by: 'quill', text: 'Which cache?', options: ['Disk', 'Memory'] },
};
const noteAsks = {
  ref: 'B-1',
  snippet: 'The Aprobar button is hidden',
  question: 1,
  by: 'lia',
  text: 'Only Aprobar?',
};

function told(...signals: ReturnType<typeof signalsOf>): Notice[] {
  const planner = new Planner(() => 12 * 60);
  planner.offer(signals, DEFAULT_PREFS, T0);
  return planner.take(T0 + GATHER_MS, new Set(signals.map(({ key }) => key)), DEFAULT_PREFS);
}

describe('B-1 as an item and as a Bandeja note', () => {
  it('opens the item for a question on a real item named B-1', () => {
    const [notice] = told(...signalsOf([itemAsks], T0));

    expect(notice && noticeText(notice, 'en')).toMatchObject({
      title: 'quill asks you · B-1',
      tag: 'otea-item-B-1',
      url: '/#/i/B-1',
      item: 'B-1',
    });
  });

  it('opens Hablar at the note for a question on a note named B-1', () => {
    const [notice] = told(...bandejaSignalsOf([noteAsks]));

    expect(notice && noticeText(notice, 'en')).toMatchObject({
      tag: 'otea-bandeja-B-1',
      url: '/#/hablar/B-1',
      item: null,
    });
  });

  it('tells both when both wait, neither taking the other’s place', () => {
    const notices = told(...signalsOf([itemAsks], T0), ...bandejaSignalsOf([noteAsks]));

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'group', count: 2 });
  });
});
