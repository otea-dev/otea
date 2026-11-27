import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { insertEvidence, selectEvents } from '../store/queries.ts';
import { postPersonMessage } from './conversation.ts';
import { answerSecretaryTap, sayWithSendBack } from './conversation-act.ts';
import { createItem, getItem } from './items.ts';
import { approveItem, handoffItem, sendBackItem } from './next.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const T0 = Date.parse('2026-11-26T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();

// U4 (field study 4): the person changed their mind in Hablar about an item already in their review,
// and had to open it and paste the secretary's note themselves. The secretary now asks with a card
// whose first option, tapped by the person, sends the item back for them with that note: the person
// is the actor, the secretary never acts alone.
describe('the secretary asks the person to send an item back, and their tap does it', () => {
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

  const ask = (note = 'Make it 404, only the message changes.') =>
    sayWithSendBack(
      project,
      {
        agent: 'sol',
        text: `Send ${id} back with this note?`,
        options: [`Send ${id} back`, 'No'],
        action: { kind: 'send_back', item: id, note },
      },
      now,
    ).message;

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    handIn();
    declareSecretary(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  const where = () => getItem(project, id);
  const sentBack = () => selectEvents(project.db, id).filter(({ type }) => type === 'transitioned');

  it('asks and moves nothing: the secretary never sends it back itself', () => {
    const before = where().state;

    const card = ask();

    expect(card.options).toEqual([`Send ${id} back`, 'No']);
    // Bound to the round of the review it was asked in.
    expect(card.action).toEqual({
      kind: 'send_back',
      item: id,
      note: 'Make it 404, only the message changes.',
      round: 1,
      to: 'Concepto',
    });
    expect(where().state).toBe(before);
  });

  it('sends the item back as the person with the drafted note when they tap the first option', () => {
    const card = ask();

    const answer = answerSecretaryTap(project, card.id, { option: 1 }, now);

    expect(answer).toMatchObject({ author: 'person', replyTo: card.id, text: `Send ${id} back` });
    expect(where().state).not.toMatch(/review/);
    const last = sentBack().at(-1);
    expect(last?.actor).toEqual(you);
    expect(last?.data).toMatchObject({
      reason: 'Make it 404, only the message changes.',
      channel: 'ui',
    });
  });

  it('sends it back with the note the person edited', () => {
    const card = ask();

    answerSecretaryTap(project, card.id, { option: 1, note: '  Use 410 instead.  ' }, now);

    expect(sentBack().at(-1)?.data).toMatchObject({ reason: 'Use 410 instead.' });
  });

  it('leaves the item in their review when they tap the other option', () => {
    const card = ask();
    const before = where().state;

    const answer = answerSecretaryTap(project, card.id, { option: 2 }, now);

    expect(answer.text).toBe('No');
    expect(where().state).toBe(before);
  });

  it('wakes the secretary with the tap, like any answer of the person', () => {
    const card = ask();
    answerSecretaryTap(project, card.id, { option: 1 }, now);

    expect(secretaryWake(project, startSecretaryWait(now), now)?.kind).toBe('person_message');
  });

  it('is never left to the secretary: delegating the decision is refused', () => {
    const card = ask();

    expect(() => answerSecretaryTap(project, card.id, { delegate: true }, now)).toThrow(
      /only you decide/,
    );
    expect(where().state).toMatch(/review/);
  });

  it('refuses a tap after the item moved on, and keeps the question open', () => {
    const card = ask();
    approveItem(project, { id, actor: you, channel: 'ui' }, now);

    expect(() => answerSecretaryTap(project, card.id, { option: 1 }, now)).toThrow(
      /not waiting for your review/,
    );
    // Nothing was recorded: the person's own words still answer it.
    expect(answerSecretaryTap(project, card.id, { text: 'never mind' }, now).replyTo).toBe(card.id);
  });

  // A card binds to the round it was asked in, not only to the item: sent back and handed in again
  // meanwhile, the old card's tap would send back a delivery its note was never about.
  it('refuses a tap once the item was sent back and handed in again since the card was asked', () => {
    const card = ask();
    sendBackItem(project, { id, actor: you, channel: 'ui', reason: 'from the desk' }, now);
    insertEvidence(project.db, {
      itemId: id,
      role: 'after',
      module: 'eart',
      kind: 'image',
      filename: 'b.png',
      contentType: 'image/png',
      size: 1,
      sha256: 'b'.repeat(64),
      caption: null,
      createdAt: now(),
      actor: quill,
      channel: 'cli',
    });
    handoffItem(project, { id, actor: quill, channel: 'cli', note: 'again' }, now);
    expect(where().state).toMatch(/review/);

    expect(() => answerSecretaryTap(project, card.id, { option: 1 }, now)).toThrow(
      /handed in again|changed since/,
    );
    expect(where().state).toMatch(/review/);
  });

  it('records where the person tapped, as the desk’s own send-back does', () => {
    const card = ask();

    answerSecretaryTap(project, card.id, { option: 1 }, now, 'human', 'phone');

    expect(sentBack().at(-1)?.data).toMatchObject({ surface: 'phone' });
  });

  it('is answered once: a second tap neither sends it back twice nor answers twice', () => {
    const card = ask();
    answerSecretaryTap(project, card.id, { option: 1 }, now);
    const moves = sentBack().length;

    expect(() => answerSecretaryTap(project, card.id, { option: 1 }, now)).toThrow(
      /already answered/,
    );
    expect(sentBack()).toHaveLength(moves);
  });

  it('refuses a card for an item that is not in their review, or with no options to tap', () => {
    const other = createItem(
      project,
      { collection: 'Criaturas', title: 'Sapo', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;

    expect(() =>
      sayWithSendBack(
        project,
        {
          agent: 'sol',
          text: 'Send it back?',
          options: ['Yes', 'No'],
          action: { kind: 'send_back', item: other, note: 'x' },
        },
        now,
      ),
    ).toThrow(/not waiting for your review/);
    expect(() =>
      sayWithSendBack(
        project,
        { agent: 'sol', text: 'Send it back?', action: { kind: 'send_back', item: id, note: 'x' } },
        now,
      ),
    ).toThrow(/needs its options/);
  });

  it('is never sent back for a message of the person alone: the card is the secretary’s question', () => {
    const wrote = postPersonMessage(project, { text: 'change of mind' }, now).message;

    expect(() => answerSecretaryTap(project, wrote.id, { option: 1 }, now)).toThrow(
      /not a question with options/,
    );
  });
});
