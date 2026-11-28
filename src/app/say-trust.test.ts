import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markRead } from '../store/conversation.ts';
import { declareAssistant } from './assistant.ts';
import { captureToBandeja, fileBandeja, takeBandeja } from './bandeja.ts';
import { addCollection } from './collections.ts';
import {
  answerAssistantQuestion,
  correctKind,
  linkMessageToItem,
  listConversation,
  openQuestionsOfTurn,
  postPersonMessage,
  retractAnswer,
  sayAsAssistant,
  withdrawQuestion,
} from './conversation.ts';
import { createItem, moveItem } from './items.ts';
import { pendingOf } from './pending.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
let tick = 0;
const now = () => new Date(T0 + 1000 * ++tick).toISOString();
const lia = { kind: 'agent' as const, name: 'lia' };

// U8 (field study 4): a `say` refused because one link came from the Bandeja left the person on
// «leído · pensando…» for ten minutes; two questions already settled kept counting in Te espera.
describe('what the assistant says and asks', () => {
  let project: Project;

  beforeEach(() => {
    project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    declareAssistant(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  const made = (title: string) =>
    createItem(
      project,
      { collection: 'tasks', title, fields: { description: 'D' }, actor: lia },
      now,
    ).id;

  const waiting = () =>
    pendingOf(project, now, { blocks: false })
      .entries.filter(({ kind }) => kind === 'assistant')
      .map(({ ref }) => Number(ref));

  describe('an answer that names an item that came from the Bandeja', () => {
    it('is posted, and says that one link does not hang from the message', () => {
      const note = captureToBandeja(project, { text: 'una idea' }, now).entry;
      takeBandeja(project, { id: note.id, agent: 'lia' }, now);
      const fromNote = made('From the note');
      fileBandeja(project, { id: note.id, agent: 'lia', item: fromNote }, now);
      const plain = made('Plain');
      const asked = postPersonMessage(project, { text: '¿qué me espera hoy?' }, now).message;

      const said = sayAsAssistant(
        project,
        { agent: 'sol', text: 'Te espera uno.', replyTo: asked.id, links: [fromNote, plain] },
        now,
      );

      expect(said.message.text).toBe('Te espera uno.');
      expect(said.message.links).toEqual([plain]);
      expect(said.warnings).toHaveLength(1);
      expect(said.warnings[0]).toContain(fromNote);
      expect(said.warnings[0]).toContain('B-');
    });
  });

  describe('an option that needs the person’s own words', () => {
    const asked = () =>
      sayAsAssistant(
        project,
        {
          agent: 'sol',
          text: '¿Qué hago con la cancha?',
          options: ['Anótala', 'Otra cosa', 'Déjala'],
          optionText: [2],
        },
        now,
      ).message;

    it('is not answered by the tap alone: the words come with it, and only with it', () => {
      const question = asked();
      expect(question.optionText).toEqual([2]);

      expect(() => answerAssistantQuestion(project, question.id, { option: 2 }, now)).toThrow(
        /needs your own words/,
      );
      expect(() =>
        answerAssistantQuestion(project, question.id, { option: 1, explain: 'x' }, now),
      ).toThrow(/takes no words/);
      const answer = answerAssistantQuestion(
        project,
        question.id,
        { option: 2, explain: 'la explico al responder' },
        now,
      );

      expect(answer.text).toBe('Otra cosa — la explico al responder');
      expect(answer.choice).toMatchObject({ mode: 'option', option: 2 });
    });

    it('is taken back with Deshacer while the assistant has not heard it, and not after', () => {
      const question = asked();
      const answer = answerAssistantQuestion(project, question.id, { option: 1 }, now);
      expect(waiting()).toEqual([]);

      retractAnswer(project, question.id, now);

      expect(waiting()).toEqual([question.id]);
      expect(listConversation(project).messages.map(({ id }) => id)).not.toContain(answer.id);
      // Heard, or too old: it stays.
      const again = answerAssistantQuestion(project, question.id, { option: 3 }, now);
      markRead(project.db, [again.id], now());
      expect(() => retractAnswer(project, question.id, now)).toThrow(/already has your answer/);
    });

    it('is not taken back when it was words the person wrote, only a tap on an option', () => {
      const question = asked();
      answerAssistantQuestion(project, question.id, { text: 'mejor la explico aquí' }, now);

      expect(() => retractAnswer(project, question.id, now)).toThrow(/only a tap/);
    });

    it('names no option that is not there', () => {
      expect(() =>
        sayAsAssistant(
          project,
          { agent: 'sol', text: '¿?', options: ['a', 'b'], optionText: [3] },
          now,
        ),
      ).toThrow(/names no option/);
    });
  });

  describe('a question that was settled elsewhere', () => {
    const ask = (text: string, extra: Partial<Parameters<typeof sayAsAssistant>[1]> = {}) =>
      sayAsAssistant(project, { agent: 'sol', text, options: ['Sí', 'No'], ...extra }, now).message;

    it('stops counting once the assistant withdraws it, and only its own question', () => {
      const question = ask('¿Lo anoto?');
      expect(waiting()).toEqual([question.id]);

      withdrawQuestion(project, { agent: 'sol', id: question.id }, now);

      expect(waiting()).toEqual([]);
      expect(listConversation(project).messages.find(({ id }) => id === question.id)).toMatchObject(
        { closed: { why: 'withdrawn' } },
      );
      expect(() => withdrawQuestion(project, { agent: 'sol', id: question.id }, now)).toThrow(
        /already|closed/,
      );
      const said = postPersonMessage(project, { text: 'hola' }, now).message;
      expect(() => withdrawQuestion(project, { agent: 'sol', id: said.id }, now)).toThrow(
        /not a question/,
      );
    });

    it('stops counting once the person answered it, as it always did', () => {
      const question = ask('¿Lo anoto?');

      answerAssistantQuestion(project, question.id, { option: 1 }, now);

      expect(waiting()).toEqual([]);
    });

    it('closes when the turn it was asked in becomes an item, whichever way the person took it', () => {
      const wrote = postPersonMessage(project, { text: 'agrega /health' }, now).message;
      const question = ask('¿Lo anoto?', { replyTo: wrote.id });
      expect(waiting()).toEqual([question.id]);

      correctKind(project, wrote.id, 'request');

      expect(waiting()).toEqual([]);
    });

    it('stays open when an item is made from its turn: the assistant says if the item answers it', () => {
      const wrote = postPersonMessage(project, { text: 'agrega /health' }, now).message;
      const question = ask('¿Lo anoto?', { replyTo: wrote.id });

      linkMessageToItem(project, 'sol', wrote.id, made('Health'), now);

      expect(waiting()).toEqual([question.id]);
      expect(openQuestionsOfTurn(project, wrote.root)).toEqual([question.id]);
    });

    it('is not closed by a move that is no tap of the person’s: a terminal or a relay says nothing they did', () => {
      const id = made('Cancha');
      ask('¿Por cancha también?', { links: [id] });

      moveItem(
        project,
        { id, to: 'in_progress', actor: { kind: 'human', name: 'human' }, channel: 'cli' },
        now,
      );

      expect(waiting()).toHaveLength(1);
    });

    it('closes when the person moves the item it is about', () => {
      const id = made('Cancha');
      ask('¿Por cancha también?', { links: [id] });
      expect(waiting()).toHaveLength(1);

      // The person's move, the way the desk records it.
      moveItem(
        project,
        { id, to: 'in_progress', actor: { kind: 'human', name: 'human' }, channel: 'ui' },
        now,
      );

      expect(waiting()).toEqual([]);
    });
  });
});
