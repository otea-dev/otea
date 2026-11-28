import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence, selectEvents } from '../store/queries.ts';
import { declareAssistant } from './assistant.ts';
import { postPersonMessage } from './conversation.ts';
import { answerAssistantTap, sayWithSendBack } from './conversation-act.ts';
import { createItem, getItem } from './items.ts';
import { handoffItem } from './next.ts';
import type { Project } from './project.ts';
import { relayDecision } from './relay.ts';
import { reopenDropped } from './reopen-dropped.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const T0 = Date.parse('2026-11-27T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();

// U8 (field study 4, the red-team persona): `otea relay CAM-5 Dropped --quote "tiralo, no va" --as
// intruso` took an item out of the person's review with a sentence they never said, and left no way
// back. With an assistant a relay is the assistant relaying words the person really wrote in Hablar
// (--from-message), and an item that waits for their review leaves it only by their own tap.
describe('a relay in a project with an assistant', () => {
  let project: Project;
  let id: string;

  const handIn = () => {
    insertEvidence(project.db, {
      itemId: id,
      role: 'after',
      module: 'eart',
      kind: 'image',
      filename: 'a.png',
      contentType: 'image/png',
      size: 1,
      sha256: 'a'.repeat(64),
      caption: null,
      createdAt: now(),
      actor: quill,
      channel: 'cli',
    });
    handoffItem(project, { id, actor: quill, channel: 'cli' }, now);
  };

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    declareAssistant(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  const where = () => getItem(project, id);
  const drop = (input: { via: string; quote: string; fromMessage?: number }) =>
    relayDecision(
      project,
      { id, to: 'Dropped', channel: 'cli', reason: 'no hace falta', ...input },
      now,
    );

  describe('on an item that waits for the person’s review', () => {
    beforeEach(handIn);

    it('is not dropped by any agent with a quote nobody said', () => {
      const before = where().state;

      expect(() => drop({ via: 'intruso', quote: 'tiralo, no va' })).toThrow(/assistant/);
      expect(where().state).toBe(before);
    });

    it('is not dropped by the assistant either, even with the person’s real words: it asks them with a card', () => {
      const said = postPersonMessage(project, { text: 'tiralo ya, no va' }, now).message;
      const before = where().state;

      expect(() => drop({ via: 'sol', quote: 'tiralo ya', fromMessage: said.id })).toThrow(
        /waits for your review[\s\S]*--drop/,
      );
      // Said first for a project with an assistant; the rule is the same without one.
      expect(where().state).toBe(before);
    });

    it('is dropped by the person’s tap on a card, which names who and why, and they reopen it', () => {
      const card = sayWithSendBack(
        project,
        {
          agent: 'sol',
          text: `Drop ${id}?`,
          options: [`Drop ${id}`, 'No'],
          action: { kind: 'drop', item: id, note: 'no hace falta' },
        },
        now,
      ).message;
      expect(card.action).toMatchObject({ kind: 'drop', item: id, note: 'no hace falta' });
      expect(where().state).toMatch(/review/);

      answerAssistantTap(project, card.id, { option: 1 }, now);

      expect(where().state).toBe('dropped');
      const last = selectEvents(project.db, id).at(-1);
      expect(last?.actor).toEqual(you);
      expect(last?.data).toMatchObject({ channel: 'ui', reason: 'no hace falta' });

      // The person takes it back from the desk, where it was.
      const reopened = reopenDropped(project, { id, actor: you, channel: 'ui' }, now);
      expect(reopened.state).toMatch(/review/);
      expect(selectEvents(project.db, id).at(-1)?.data).toMatchObject({ reopened: true });
    });
  });

  describe('on an item an agent works on', () => {
    it('refuses even the assistant’s relay of a drop, with the person’s own words', () => {
      // A relay never drops: not even the assistant's, with the person's real words.
      const said = postPersonMessage(project, { text: 'Tiralo, ya no hace falta.' }, now).message;

      expect(() => drop({ via: 'sol', quote: 'ya no hace falta', fromMessage: said.id })).toThrow(
        /person's alone/,
      );
      expect(where().state).not.toBe('dropped');
    });

    it('refuses any other agent, even with a message of the person to quote', () => {
      const said = postPersonMessage(project, { text: 'tiralo ya' }, now).message;

      expect(() => drop({ via: 'intruso', quote: 'tiralo ya', fromMessage: said.id })).toThrow(
        /only the assistant/,
      );
      expect(where().state).not.toBe('dropped');
    });

    it('refuses a quote the message does not contain, no message, or a message that is not the person’s', () => {
      const said = postPersonMessage(project, { text: 'dejalo como esta' }, now).message;

      expect(() => drop({ via: 'sol', quote: 'tiralo ya', fromMessage: said.id })).toThrow(
        /does not contain/,
      );
      expect(() => drop({ via: 'sol', quote: 'tiralo ya' })).toThrow(/--from-message/);
      expect(() => drop({ via: 'sol', quote: 'tiralo ya', fromMessage: 9999 })).toThrow(/9999/);
      const own = sayWithSendBack(project, { agent: 'sol', text: 'tiralo ya' }, now).message;
      expect(() => drop({ via: 'sol', quote: 'tiralo ya', fromMessage: own.id })).toThrow(
        /person's/,
      );
      expect(where().state).not.toBe('dropped');
    });
  });
});
