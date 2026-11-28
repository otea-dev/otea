import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCollection } from './collections.ts';
import { linkMessageToItem, postPersonMessage, sayAsSecretary } from './conversation.ts';
import { createItem } from './items.ts';
import type { Project } from './project.ts';
import { declareSecretary } from './secretary.ts';
import { memoryContext, projectOf } from './testing.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

// D-274c07 (final study): «Lo que salió» showed the person's code requests as «hecho» because the
// secretary had linked each of them to the one item that was done (PED-1, the board's sketch). A
// link says whether the item was made from the turn (`made`) or only mentioned by it, so the card
// reads «hecho» for what was made and done, and «sin ítem» for a request nothing was made from.
describe('the items a turn made, and those it only mentions', () => {
  let project: Project;

  beforeEach(() => {
    project = projectOf('/nowhere', memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });
  afterEach(() => project.db.close());

  const item = (title: string, at: number) =>
    createItem(
      project,
      {
        collection: 'tasks',
        title,
        fields: { description: 'x' },
        actor: { kind: 'agent', name: 'sol' },
      },
      clock(at),
    ).id;
  const asked = (text: string, at: number) =>
    postPersonMessage(project, { text }, clock(at)).message;
  const turn = (message: number) =>
    // the message as the conversation reads it
    project.db
      .prepare('SELECT item_id AS item, made FROM conversation_links WHERE message_id = ?')
      .all(message) as { item: string; made: number }[];

  it('marks an item created from the message as made', () => {
    const request = asked('add a health check', 1000);
    const made = item('health', 2000);

    linkMessageToItem(project, 'sol', request.id, made, clock(2000));

    expect(turn(request.id)).toEqual([{ item: made, made: 1 }]);
  });

  it('marks an item the secretary only mentions as not made, and one made after the turn as made', () => {
    const before = item('Sketch the board', 500);
    const request = asked('add POST /products', 1000);
    const after = item('POST /products', 3000);

    sayAsSecretary(
      project,
      { agent: 'sol', text: 'Noted.', replyTo: request.id, kind: 'request', links: [before] },
      clock(2000),
    );
    sayAsSecretary(
      project,
      { agent: 'sol', text: 'Made it.', replyTo: request.id, kind: 'request', links: [after] },
      clock(4000),
    );

    expect(turn(request.id)).toEqual([
      { item: before, made: 0 },
      { item: after, made: 1 },
    ]);
  });

  it('gives the made items on the message, apart from the links', () => {
    const before = item('Sketch the board', 500);
    const request = asked('add POST /products', 1000);
    const after = item('POST /products', 3000);
    sayAsSecretary(
      project,
      {
        agent: 'sol',
        text: 'Noted.',
        replyTo: request.id,
        kind: 'request',
        links: [before, after],
      },
      clock(4000),
    );

    const said = sayAsSecretary(
      project,
      { agent: 'sol', text: 'Again.', replyTo: request.id },
      clock(5000),
    ).message;

    expect(said.links).toEqual([before, after]);
    expect(said.made).toEqual([after]);
  });
});
