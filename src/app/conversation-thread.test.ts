import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureToBandeja, fileBandeja, takeBandeja } from './bandeja.ts';
import { addCollection } from './collections.ts';
import {
  answerSecretaryQuestion,
  conversationText,
  correctKind,
  linkMessageToItem,
  listConversation,
  postPersonMessage,
  readAsSecretary,
  requireLinkableMessage,
  sayAsSecretary,
  turnsOfItem,
} from './conversation.ts';
import { createItem } from './items.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf } from './testing.ts';

// The conversation as a thread (0.8 fix round, field study 3): the secretary's news are messages of
// their own at the foot, the person's turns keep their kind and links, a correction of a kind wakes
// the secretary, a question of the secretary comes with options to tap, and a tap goes back to it.

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

describe('the conversation as a thread', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-thread-'));
    project = projectOf(root, memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const post = (text: string, at = 1000) => postPersonMessage(project, { text }, clock(at)).message;
  const item = (title: string) =>
    createItem(project, {
      collection: 'tasks',
      title,
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'sol' },
    }).id;
  const read = (at = 1500) => readAsSecretary(project, { agent: 'sol' }, clock(at));
  const messages = () => listConversation(project).messages;

  describe('news of the secretary', () => {
    it('a say with no --reply-to is a notice of its own: it changes nothing of the person’s turns, and its links are its own', () => {
      const asked = post('retries with backoff?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'It is a design question.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      const fix = item('Retry with backoff');

      const notice = sayAsSecretary(
        project,
        { agent: 'sol', text: `${fix} is ready for your review.`, links: [fix] },
        clock(3000),
      );

      expect(notice.message).toMatchObject({
        replyTo: null,
        root: notice.message.id,
        links: [fix],
        kind: null,
      });
      const turn = messages().filter(({ root }) => root === asked.id);
      expect(turn.map(({ kind, links }) => [kind, links])).toEqual([
        ['consultation', []],
        ['consultation', []],
      ]);
      // The notice is no origin of the item: the item does not say it came from it.
      expect(turnsOfItem(project, fix)).toEqual([]);
    });

    it('a reply to a turn the secretary already classified cannot flip it with --request and --links', () => {
      const asked = post('retries with backoff?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'It is a design question.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      const fix = item('Retry with backoff');

      expect(() =>
        sayAsSecretary(
          project,
          { agent: 'sol', text: `Made ${fix}.`, replyTo: asked.id, kind: 'request', links: [fix] },
          clock(3000),
        ),
      ).toThrow(/already a consultation.*notice/s);
      expect(messages().map(({ kind }) => kind)).toEqual(['consultation', 'consultation']);
    });

    it('never hangs an item that came from a Bandeja note under a turn of the person’s', () => {
      const asked = post('please make these two things', 1000);
      read(1500);
      captureToBandeja(project, { text: 'the points are wrong' }, clock(1600));
      takeBandeja(project, { id: 1, agent: 'lia' }, clock(1700));
      const fromNote = item('Fix the points');
      fileBandeja(project, { id: 1, agent: 'lia', item: fromNote }, clock(1800));
      const made = item('Another thing');

      expect(() =>
        sayAsSecretary(
          project,
          { agent: 'sol', text: 'Made both.', replyTo: asked.id, links: [made, fromNote] },
          clock(2000),
        ),
      ).toThrow(new RegExp(`${fromNote}.*Bandeja`, 's'));
      expect(turnsOfItem(project, fromNote)).toEqual([]);
      // A notice may mention it all the same.
      const notice = sayAsSecretary(
        project,
        { agent: 'sol', text: `${fromNote} is on its way.`, links: [fromNote] },
        clock(2500),
      );
      expect(notice.message.links).toEqual([fromNote]);
      expect(turnsOfItem(project, fromNote)).toEqual([]);
    });
  });

  describe('a kind the person corrected', () => {
    it('wakes the secretary, who reads it as changed by the person, until it has read it', () => {
      const asked = post('would export to Markdown be worth it?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'Maybe.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      expect(secretaryWake(project, startSecretaryWait(clock(2500)), clock(2500))).toBeUndefined();

      const corrected = correctKind(project, asked.id, 'request');

      expect(corrected).toMatchObject({ kind: 'request', kindBy: 'person', kindNews: true });
      const woke = secretaryWake(project, startSecretaryWait(clock(3500)), clock(3500));
      expect(woke).toMatchObject({ kind: 'kind_changed', ref: String(asked.id) });
      expect(woke?.text).toMatch(/changed.*request/);
      // Every look finds it until it is read.
      expect(secretaryWake(project, startSecretaryWait(clock(3600)), clock(3600))?.kind).toBe(
        'kind_changed',
      );

      const seen = readAsSecretary(project, { agent: 'sol' }, clock(4000));
      expect(seen.messages.map(({ id }) => id)).toContain(asked.id);
      expect(conversationText('sol', seen)).toMatch(
        new RegExp(`\\[${asked.id}\\].*request \\(changed by the person\\)`),
      );
      expect(secretaryWake(project, startSecretaryWait(clock(5000)), clock(5000))).toBeUndefined();
      expect(messages().every(({ kindNews }) => !kindNews)).toBe(true);
    });

    // The times of the messages are UTC; what the secretary tells the person is in their time.
    it("says what the person's clock reads, beside the times in UTC", () => {
      const noon = Date.parse('2026-11-26T12:00:00Z');
      post('what time did it start?', 3000);
      expect(conversationText('sol', read(4000), noon, 'Europe/Madrid')).toContain(
        "The person's clock now: 13:00 (UTC+1, Europe/Madrid). The times above are UTC: tell the person times as their clock reads.",
      );
    });

    it('is not news when the person sets back what it already was', () => {
      const asked = post('would export to Markdown be worth it?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'Maybe.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );

      const same = correctKind(project, asked.id, 'consultation');

      expect(same.kindNews).toBe(false);
      expect(secretaryWake(project, startSecretaryWait(clock(3500)), clock(3500))).toBeUndefined();
    });
  });

  describe('review round: several open questions, wakes, taps, limits', () => {
    const ask = (text: string, at: number) =>
      sayAsSecretary(
        project,
        { agent: 'sol', text, options: ['Yes', 'No'], recommended: 1 },
        clock(at),
      ).message;

    it('keeps several questions open: each is answered by a tap on it, in any order, and what the person says freely answers none', () => {
      const q1 = ask('First?', 2000);
      const q2 = ask('Second?', 2100);

      answerSecretaryQuestion(project, q2.id, { option: 1 }, clock(3000));
      // A question after another was answered is still open.
      expect(answerSecretaryQuestion(project, q1.id, { option: 2 }, clock(3100)).replyTo).toBe(
        q1.id,
      );
      expect(() => answerSecretaryQuestion(project, q2.id, { option: 2 }, clock(3200))).toThrow(
        /already answered/,
      );

      const q3 = ask('Third?', 4000);
      post('something else entirely', 4100);
      expect(answerSecretaryQuestion(project, q3.id, { option: 1 }, clock(4200)).replyTo).toBe(
        q3.id,
      );
    });

    it('stops waking for a changed kind once the secretary acts on that turn, without reading it', () => {
      const asked = post('would export to Markdown be worth it?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'Maybe.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      correctKind(project, asked.id, 'request');
      expect(secretaryWake(project, startSecretaryWait(clock(3000)), clock(3000))?.kind).toBe(
        'kind_changed',
      );

      sayAsSecretary(project, { agent: 'sol', text: 'On it.', replyTo: asked.id }, clock(3500));

      expect(secretaryWake(project, startSecretaryWait(clock(4000)), clock(4000))).toBeUndefined();
      expect(messages().every(({ kindNews }) => !kindNews)).toBe(true);
    });

    it('stops waking for a changed kind once an item is made from that turn', () => {
      const asked = post('would export to Markdown be worth it?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'Maybe.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      correctKind(project, asked.id, 'request');

      linkMessageToItem(project, 'sol', asked.id, item('Export to Markdown'), clock(3000));

      expect(secretaryWake(project, startSecretaryWait(clock(4000)), clock(4000))).toBeUndefined();
    });

    it('wakes for a changed kind twice at most when the secretary does nothing', () => {
      const asked = post('would export to Markdown be worth it?', 1000);
      read(1500);
      sayAsSecretary(
        project,
        { agent: 'sol', text: 'Maybe.', replyTo: asked.id, kind: 'consultation' },
        clock(2000),
      );
      correctKind(project, asked.id, 'request');

      const wakes = [3000, 3100, 3200, 3300].map(
        (at) => secretaryWake(project, startSecretaryWait(clock(at)), clock(at))?.kind,
      );

      expect(wakes).toEqual(['kind_changed', 'kind_changed', undefined, undefined]);
    });

    it('lets the secretary classify and link the person’s tap, by default or by number, and refuses a notice before anything is made', () => {
      const question = ask('Note it?', 2000);
      const tap = answerSecretaryQuestion(project, question.id, { option: 1 }, clock(3000));
      read(3500);

      // The tap is the latest message of the person's: the default turn.
      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Noted.', kind: 'request' },
        clock(4000),
      );
      expect(said.message.replyTo).toBe(tap.id);
      expect(linkMessageToItem(project, 'sol', tap.id, item('Note it'), clock(4100))).toMatchObject(
        { kind: 'request' },
      );

      // A message of the secretary's is no turn of the person's: refused up front.
      expect(() => requireLinkableMessage(project, 'sol', question.id)).toThrow(/notice/);
      expect(() => requireLinkableMessage(project, 'sol', tap.id)).not.toThrow();
    });

    it('refuses to correct the kind of a notice, and an answer past the message limit', () => {
      const notice = sayAsSecretary(project, { agent: 'sol', text: 'FYI.' }, clock(2000)).message;
      const question = ask('Note it?', 2100);

      expect(() => correctKind(project, notice.id, 'request')).toThrow(/notice/);
      expect(() =>
        answerSecretaryQuestion(project, question.id, { text: 'x'.repeat(20_001) }, clock(3000)),
      ).toThrow(/at most 20000 characters/);
    });
  });

  describe('a question of the secretary', () => {
    it('comes with options to tap and the one it recommends', () => {
      const asked = post('would it be good to have a boss on floor 3?', 1000);
      read(1500);

      const question = sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'What do I do with it?',
          replyTo: asked.id,
          options: ['Note it', 'Leave it as an idea'],
          recommended: 1,
        },
        clock(2000),
      ).message;

      expect(question).toMatchObject({
        options: ['Note it', 'Leave it as an idea'],
        recommended: 1,
      });
      expect(() =>
        sayAsSecretary(project, { agent: 'sol', text: 'x?', options: ['only one'] }, clock(2100)),
      ).toThrow(/2 to 4/);
      expect(() =>
        sayAsSecretary(
          project,
          { agent: 'sol', text: 'x?', options: ['a', 'b'], recommended: 3 },
          clock(2100),
        ),
      ).toThrow(/recommend/i);
    });

    it('the tap is the person’s answer: a message that wakes the secretary and is its answer, once', () => {
      const question = sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'Note it or leave it?',
          options: ['Note it', 'Leave it'],
          recommended: 1,
        },
        clock(2000),
      ).message;

      const tapped = answerSecretaryQuestion(project, question.id, { option: 2 }, clock(3000));

      expect(tapped).toMatchObject({
        author: 'person',
        text: 'Leave it',
        replyTo: question.id,
        delivery: 'pending',
        choice: { mode: 'option', about: null },
      });
      expect(secretaryWake(project, startSecretaryWait(clock(3500)), clock(3500))).toMatchObject({
        kind: 'person_message',
        ref: String(tapped.id),
      });
      const seen = read(4000);
      expect(conversationText('sol', seen)).toContain('chose option 2');
      expect(() =>
        answerSecretaryQuestion(project, question.id, { option: 1 }, clock(5000)),
      ).toThrow(/already answered/);
      expect(() => answerSecretaryQuestion(project, tapped.id, { option: 1 }, clock(5000))).toThrow(
        /no question|options/i,
      );
    });

    it('may be left to the secretary to decide', () => {
      const question = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Note it or leave it?', options: ['Note it', 'Leave it'] },
        clock(2000),
      ).message;

      const tapped = answerSecretaryQuestion(project, question.id, { delegate: true }, clock(3000));

      expect(tapped.choice).toMatchObject({ mode: 'delegated' });
      expect(conversationText('sol', read(4000))).toMatch(/decide|your call/i);
    });
  });

  describe('what the person sees at once', () => {
    it('is noted as heard the moment the secretary’s wait returns the message, before it is read', () => {
      const asked = post('hello', 1000);
      expect(asked.heardAt).toBeNull();

      const woke = secretaryWake(project, startSecretaryWait(clock(2000)), clock(2000));

      expect(woke?.kind).toBe('person_message');
      const after = messages()[0];
      expect(after).toMatchObject({ delivery: 'pending', heardAt: clock(2000)() });
      // Heard once: a later look keeps the first time.
      secretaryWake(project, startSecretaryWait(clock(3000)), clock(3000));
      expect(messages()[0]?.heardAt).toBe(clock(2000)());
    });
  });
});
