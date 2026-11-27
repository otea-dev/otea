import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCollection } from './collections.ts';
import {
  linkMessageToItem,
  postPersonMessage,
  readAsSecretary,
  sayAsSecretary,
} from './conversation.ts';
import { createItem } from './items.ts';
import { noteHarness } from './presence.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

// U6 (field study 4, wave 2b): the secretary read a message, its reply was refused, and a restarted
// secretary's wait said «nothing reached the secretary» while Hablar read «escuchando» and «leído ·
// pensando…» for 20 minutes. Read is not answered: a message stays owed until the secretary replies
// to it or makes something from it.
describe('a message the secretary read and did not answer is owed', () => {
  let project: Project;

  beforeEach(() => {
    project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => project.db.close());

  // The person writes at `at`; the secretary's wait returns it and it reads it.
  const written = (text: string, at: number) => {
    const message = postPersonMessage(project, { text }, clock(at)).message;
    expect(secretaryWake(project, startSecretaryWait(clock(at + 1)), clock(at + 1))).toMatchObject({
      kind: 'person_message',
    });
    readAsSecretary(project, { agent: 'sol' }, clock(at + 2));
    return message;
  };

  // A wait that began at `at`.
  const waitAt = (at: number) => secretaryWake(project, startSecretaryWait(clock(at)), clock(at));

  it('comes back to the next wait, and to a restarted secretary, until it is answered', () => {
    const message = written('¿cuánto falta para la integración?', 1000);

    // Its reply is refused (a say that fails writes nothing): the next wait brings the message back.
    const again = waitAt(60_000);
    expect(again).toMatchObject({ kind: 'person_message', ref: String(message.id) });
    expect(again?.text).toContain('already read');

    // A secretary that restarts (it declares the role again) gets it on its first wait, however many
    // times the earlier session was told.
    for (let n = 0; n < 5; n++) waitAt(120_000 + n);
    declareSecretary(project.db, 'sol', clock(200_000));
    expect(waitAt(210_000)).toMatchObject({ kind: 'person_message', ref: String(message.id) });

    // Answered: it stops.
    sayAsSecretary(
      project,
      { agent: 'sol', text: 'Falta poco.', replyTo: message.id, kind: 'consultation' },
      clock(220_000),
    );
    expect(waitAt(230_000)).toBeUndefined();
  });

  it('is not brought back to the wait that was already running when it was read', () => {
    const running = startSecretaryWait(clock(0));
    const message = postPersonMessage(project, { text: 'hola' }, clock(1000)).message;
    expect(secretaryWake(project, running, clock(1001))).toMatchObject({ ref: String(message.id) });
    readAsSecretary(project, { agent: 'sol' }, clock(1002));
    expect(secretaryWake(project, running, clock(30_000))).toBeUndefined();
  });

  it('stops once an item was made from it', () => {
    const message = written('haz un cambio', 1000);
    const item = createItem(project, {
      collection: 'tasks',
      title: 'Cambio',
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'sol' },
    }).id;
    linkMessageToItem(project, 'sol', message.id, item, clock(5000));
    expect(waitAt(60_000)).toBeUndefined();
  });

  // T1a: a new session that never declares the role again (a harness restarted under the same name)
  // is the next one to be told, whatever the sessions before it were told: the one noted for the
  // secretary is another harness now.
  it('comes back to a new harness session even after the earlier ones used up the returns', () => {
    const message = written('gracias', 1000);
    noteHarness(project.db, 'sol', 4001, clock(1500), true, 1, () => true);
    for (let n = 0; n < 5; n++) waitAt(60_000 + n);
    expect(waitAt(120_000)).toBeUndefined();

    // Its harness is gone; a session under another one takes the name over.
    noteHarness(project.db, 'sol', 4002, clock(130_000), true, 2, () => false);
    expect(waitAt(140_000)).toMatchObject({ kind: 'person_message', ref: String(message.id) });
  });

  it('is let go after a few returns when the same session leaves it', () => {
    written('gracias', 1000);
    const returned = [60_000, 120_000, 180_000, 240_000, 300_000].map((at) => waitAt(at));
    expect(returned.filter((wake) => wake !== undefined).length).toBe(2);
  });
});
