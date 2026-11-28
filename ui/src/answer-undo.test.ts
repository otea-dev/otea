import { describe, expect, it } from 'vitest';
import { answerUndoable } from './answer-undo.ts';

// D-befe9d: an answer sent with a tap on an option has its Deshacer, as a move has; the ones the
// server cannot take back (words, an option with words, «decide tú») do not promise it.
describe('which answers can be taken back', () => {
  it('a tap on an option can', () => {
    expect(answerUndoable({ option: 2 })).toBe(true);
  });

  it('words, an option with words, a note on it, and leaving it to the agent cannot', () => {
    expect(answerUndoable({ text: 'Sí, pero con musgo' })).toBe(false);
    expect(answerUndoable({ option: 1, explain: 'con musgo' })).toBe(false);
    expect(answerUndoable({ option: 1, note: 'cambia la nota' })).toBe(false);
    expect(answerUndoable({ delegate: true })).toBe(false);
  });
});
