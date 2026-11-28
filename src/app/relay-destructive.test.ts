import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence } from '../store/queries.ts';
import { declareAssistant } from './assistant.ts';
import { addCollection } from './collections.ts';
import { answerAssistantQuestion, postPersonMessage, sayAsAssistant } from './conversation.ts';
import { createItem, getItem } from './items.ts';
import { handoffItem } from './next.ts';
import type { Project } from './project.ts';
import { relayDecision } from './relay.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const T0 = Date.parse('2026-11-27T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();
const DAY = 24 * 3600_000;

// Adversarial review of S: a relay is words an agent says the person said, so it may never do what
// cannot be taken back or what is the person's alone: drop, finish or approve, in review or not,
// with an assistant or without. Those are a card they tap, or the desk.
describe('what a relay may never do', () => {
  let project: Project;

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    addCollection(project, { name: 'bugs', preset: 'bug-triage' });
  });

  afterEach(() => project.db.close());

  const creature = (): string => {
    const id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
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
    return id;
  };

  const bug = (): string => {
    const id = createItem(project, { collection: 'bugs', title: 'Crash', actor: you }, now).id;
    project.db.exec(`UPDATE items SET state = 'reported' WHERE id = '${id}'`);
    return id;
  };

  it('never drops an item in review, with no assistant: the U8 repro with any worker', () => {
    const id = creature();
    const before = getItem(project, id).state;

    expect(() =>
      relayDecision(
        project,
        {
          id,
          to: 'Dropped',
          via: 'worker',
          channel: 'cli',
          quote: 'tiralo ya, no va',
          reason: 'x',
        },
        now,
      ),
    ).toThrow(/tap|desk/);
    expect(getItem(project, id).state).toBe(before);
  });

  it('never closes an item, with no assistant either', () => {
    const id = bug();

    expect(() =>
      relayDecision(
        project,
        {
          id,
          to: 'wont_fix',
          via: 'worker',
          channel: 'cli',
          quote: 'no lo arreglamos',
          reason: 'x',
        },
        now,
      ),
    ).toThrow(/tap|desk/);
    expect(getItem(project, id).state).toBe('reported');
  });

  describe('a relay that moves nothing for good', () => {
    const relay = (
      id: string,
      quote: string,
      extra: Partial<Parameters<typeof relayDecision>[1]> = {},
    ) =>
      relayDecision(
        project,
        { id, to: 'accepted', via: 'worker', channel: 'cli', quote, ...extra },
        now,
      );

    it('takes a quote of two words or more with no assistant', () => {
      const id = bug();

      expect(() => relay(id, 'sí')).toThrow(/two words/);
      expect(relay(id, 'sí, aceptalo').state).toBe('accepted');
    });

    describe('with an assistant', () => {
      beforeEach(() => declareAssistant(project.db, 'sol', now));

      const said = (text: string, at = now) => postPersonMessage(project, { text }, at).message;
      const assistantRelay = (id: string, fromMessage: number, quote: string) =>
        relay(id, quote, { via: 'sol', fromMessage });

      it('takes the person’s words from a message, once per message', () => {
        const id = bug();
        const message = said('aceptalo, es un bug real');
        assistantRelay(id, message.id, 'aceptalo, es un bug real');
        project.db.exec(`UPDATE items SET state = 'reported' WHERE id = '${id}'`);

        expect(() => assistantRelay(id, message.id, 'aceptalo, es un bug real')).toThrow(
          /already|once/,
        );
      });

      it('refuses a message older than a day', () => {
        const id = bug();
        const old = said('aceptalo, es un bug real', () => new Date(T0 - 2 * DAY).toISOString());

        expect(() => assistantRelay(id, old.id, 'aceptalo, es un bug real')).toThrow(/old|day/);
        expect(getItem(project, id).state).toBe('reported');
      });

      it('refuses what the person only tapped on a card', () => {
        const id = bug();
        const question = sayAsAssistant(
          project,
          { agent: 'sol', text: '¿Lo acepto?', options: ['Aceptarlo ya mismo', 'No'] },
          now,
        ).message;
        const tap = answerAssistantQuestion(project, question.id, { option: 1 }, now);

        expect(() => assistantRelay(id, tap.id, 'Aceptarlo ya mismo')).toThrow(/tap|typed|wrote/);
        expect(getItem(project, id).state).toBe('reported');
      });
    });
  });
});
