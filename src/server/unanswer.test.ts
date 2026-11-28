import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askOnBandeja, retractBandejaAnswer, takeBandeja } from '../app/bandeja.ts';
import { createBoard, publishBoard, saveDraft } from '../app/boards.ts';
import { createItem } from '../app/items.ts';
import { claimItem } from '../app/leases.ts';
import { seeAgent } from '../app/presence.ts';
import type { Project } from '../app/project.ts';
import { answerQuestion, askQuestion, retractItemAnswer } from '../app/questions.ts';
import { creatures } from '../core/board/testing.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// D-53015b (final study): a tap on an agent's question, on an item or on an Inbox note, sent the
// answer at once and offered no Deshacer, while the assistant's questions had one. The same rule:
// only the person, signed in, within 30 seconds, only a tapped option, and only while the agent has
// not acted on it; sent again under the same Idempotency-Key it gives the first result.
const kiln = { kind: 'agent' as const, name: 'kiln' };

describe('taking back the answer to an agent’s question', () => {
  let project: Project;
  let server: OteaServer;

  const call = (path: string, body?: unknown, key?: string) =>
    Promise.resolve(
      server.app.request(
        `/p/memory-aaaaaa/api${path}`,
        {
          method: 'POST',
          headers: {
            host: LOCAL_HOST,
            origin: `http://${LOCAL_HOST}`,
            cookie: SESSION_COOKIE,
            'content-type': 'application/json',
            ...(key === undefined ? {} : { 'idempotency-key': key }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
      ),
    );
  const traces = () =>
    project.db
      .prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE author = 'person'")
      .get()?.n;

  beforeEach(() => {
    project = memoryProject();
    const record = createBoard(project, { name: 'Criaturas', lang: 'es' });
    saveDraft(project, record.id, { definition: creatures(), baseVersion: null });
    publishBoard(project, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } });
    createItem(project, {
      collection: 'Criaturas',
      title: 'Tortuga',
      fields: { fdesc: 'Lenta' },
      actor: kiln,
      channel: 'cli',
    });
    claimItem(project, { id: 'CRI-1', actor: kiln });
    askQuestion(project, {
      id: 'CRI-1',
      text: '¿Con musgo?',
      options: ['Sí', 'No'],
      actor: kiln,
      channel: 'cli',
    });
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  describe('on an item', () => {
    it('puts the question back on the person, and drops the trace of the tap', async () => {
      await call('/items/CRI-1/answer', { question: 1, option: 1 });
      expect(traces()).toBe(1);

      const response = await call('/items/CRI-1/unanswer');

      expect(response.status).toBe(200);
      const item = (await response.json()) as { turn: string; asks?: { question: number } };
      expect(item.turn).toBe('human');
      expect(item.asks?.question).toBe(1);
      expect(traces()).toBe(0);
      // It can be answered again, the other way.
      expect((await call('/items/CRI-1/answer', { question: 1, option: 2 })).status).toBe(200);
    });

    it('is not taken back when it was words the person wrote, or nothing was answered', async () => {
      expect((await call('/items/CRI-1/unanswer')).status).toBe(409);
      await call('/items/CRI-1/answer', { question: 1, text: 'Con mucho musgo' });
      expect((await call('/items/CRI-1/unanswer')).status).toBe(409);
    });

    it('is not taken back once the agent has acted on it', async () => {
      await call('/items/CRI-1/answer', { question: 1, option: 1 });
      seeAgent(project.db, { agent: 'kiln', channel: 'cli', call: true }, () =>
        new Date(Date.now() + 1_000).toISOString(),
      );

      const response = await call('/items/CRI-1/unanswer');

      expect(response.status).toBe(409);
      const item = (await (
        await server.app.request(
          '/p/memory-aaaaaa/api/items/CRI-1',
          { headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE } },
          { incoming: { socket: { remoteAddress: '127.0.0.1' } } },
        )
      ).json()) as { turn: string };
      expect(item.turn).toBe('agent');
    });

    it('is not taken back after 30 seconds, and only by the person', () => {
      const tapped = new Date().toISOString();
      const later = () => new Date(Date.parse(tapped) + 31_000).toISOString();
      const person = { kind: 'human' as const, name: 'human' };
      answerQuestion(
        project,
        { id: 'CRI-1', option: 1, actor: person, channel: 'ui' },
        () => tapped,
      );

      expect(() => retractItemAnswer(project, { id: 'CRI-1', actor: kiln }, () => tapped)).toThrow(
        /person/,
      );
      expect(() => retractItemAnswer(project, { id: 'CRI-1', actor: person }, later)).toThrow(
        /too old/,
      );
    });

    it('gives a Deshacer sent again under the same key the first result', async () => {
      await call('/items/CRI-1/answer', { question: 1, option: 1 });

      const first = await call('/items/CRI-1/unanswer', undefined, 'undo-1');
      const again = await call('/items/CRI-1/unanswer', undefined, 'undo-1');

      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      expect(again.headers.get('idempotent-replayed')).toBe('true');
      expect(await again.json()).toEqual(await first.json());
    });
  });

  describe('on an Inbox note', () => {
    beforeEach(async () => {
      await call('/bandeja', { text: 'make it better' });
      takeBandeja(project, { id: 1, agent: 'lia' });
      askOnBandeja(project, { id: 1, agent: 'lia', text: 'Which?', options: ['a', 'b'] });
    });

    it('puts the question back on the person, and drops the trace of the tap', async () => {
      await call('/bandeja/1/answer', { question: 1, option: 1 });
      expect(traces()).toBeGreaterThan(0);
      const before = traces();

      const response = await call('/bandeja/1/unanswer');

      expect(response.status).toBe(200);
      const entry = (await response.json()) as { asking: { question: number } | null };
      expect(entry.asking?.question).toBe(1);
      expect(traces()).toBe(Number(before) - 1);
    });

    it('is not taken back when it was words the person wrote', async () => {
      await call('/bandeja/1/answer', { question: 1, text: 'the second' });
      expect((await call('/bandeja/1/unanswer')).status).toBe(409);
    });

    it('is not taken back once the refiner took the note again', async () => {
      await call('/bandeja/1/answer', { question: 1, option: 2 });
      takeBandeja(project, { id: 1, agent: 'lia' });

      expect((await call('/bandeja/1/unanswer')).status).toBe(409);
    });

    it('is not taken back after 30 seconds', async () => {
      await call('/bandeja/1/answer', { question: 1, option: 1 });
      const later = () => new Date(Date.now() + 31_000).toISOString();
      expect(() => retractBandejaAnswer(project, { id: 1 }, later)).toThrow(/too old/);
    });

    it('gives a Deshacer sent again under the same key the first result', async () => {
      await call('/bandeja/1/answer', { question: 1, option: 1 });

      const first = await call('/bandeja/1/unanswer', undefined, 'undo-b');
      const again = await call('/bandeja/1/unanswer', undefined, 'undo-b');

      expect(first.status).toBe(200);
      expect(again.headers.get('idempotent-replayed')).toBe('true');
      expect(await again.json()).toEqual(await first.json());
    });
  });
});
