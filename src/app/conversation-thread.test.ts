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
  listConversation,
  postPersonMessage,
  readAsSecretary,
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
