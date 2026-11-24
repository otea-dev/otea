import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { appendEvent, updateItemState } from '../store/queries.ts';
import { createItem } from './items.ts';
import { claimItem } from './leases.ts';
import { nextFor } from './next.ts';
import { endProcess, waitBeat } from './presence.ts';
import { setOrder } from './priority.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString();

// P1-F2: the Code on main board has every agent work straight on main with no branch, while a
// second agent in the same checkout was told to make its own worktree: three agents committing at
// once, one index.lock, a commit that was another agent's. Everyone commits on main, so the board
// takes one agent at a time on main, in the person's order, like the landing, and says so.
describe('working straight on main, one agent at a time', () => {
  function board() {
    const ctx = memoryContext();
    const def = instantiate(requireTemplate('mainline'), 'es', {}, undefined, { keep: true });
    publishAs(ctx, def, 'bmain', now);
    const doing = (title: string) => {
      const { id } = createItem(
        ctx,
        { collection: def.name, title, fields: { want: 'x' }, actor: you },
        now,
      );
      updateItemState(ctx.db, id, 'doit', now());
      return id;
    };
    return { ctx, def, doing };
  }

  it('refuses a second agent a change on main while another works on one, saying why', () => {
    const { ctx, def, doing } = board();
    const first = doing('first');
    const second = doing('second');
    claimItem(ctx, { id: first, actor: agent('claude-b') }, now);
    setOrder(ctx, { collection: def.name, ids: [first, second], actor: you }, now);

    // P1-S4: which item holds main and until when, and that what does not work there goes on.
    expect(() => claimItem(ctx, { id: second, actor: agent('quill') }, now)).toThrow(
      new RegExp(
        `^${second} not claimed: claude-b works on main with ${first} now \\(its lease runs until \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC\\), and ${second} waits for it: this board works straight on main, so one agent at a time, in the person's order, or two would change the same files\\. Items that do not work on main can be taken now: otea next\\.$`,
      ),
    );
    const idle = nextFor(ctx, 'quill', {}, now);
    expect(idle).toMatchObject({ item: null, idle: true });
    expect(idle.text).toContain(
      `${second} waits to work on main: claude-b works on ${first} there now`,
    );

    // The one that is done with main lets the next one start.
    updateItemState(ctx.db, first, 'done', now());
    expect(claimItem(ctx, { id: second, actor: agent('quill') }, now).lease?.holder).toBe('quill');
  });

  it('offers the first in the person order, and refuses the one behind it', () => {
    const { ctx, def, doing } = board();
    const behind = doing('behind');
    const top = doing('top');
    setOrder(ctx, { collection: def.name, ids: [top, behind], actor: you }, now);

    expect(nextFor(ctx, 'quill', {}, now).item).toBe(top);
    expect(() => claimItem(ctx, { id: behind, actor: agent('quill') }, now)).toThrow(
      `${top} goes first on main (order 1), then ${behind}`,
    );
  });

  // A lease that ran out while its holder's session runs is still its holder's: it may be at work
  // on a long step with no otea call, and the next agent would commit on main under it.
  it('still counts, as on main, an item whose lease ran out while its holder session runs', () => {
    const { ctx, doing } = board();
    const first = doing('first');
    const second = doing('second');
    const T0 = '2026-01-01T00:00:00.000Z';
    const T20 = '2026-01-01T00:20:00.000Z';
    const listens = (time: string) =>
      waitBeat(
        ctx.db,
        { agent: 'claude-b', channel: 'cli', waiter: process.pid },
        () => time,
      ).run();
    listens(T0);
    claimItem(ctx, { id: first, actor: agent('claude-b') }, () => T0);
    listens(T20);

    expect(() => claimItem(ctx, { id: second, actor: agent('quill') }, () => T20)).toThrow(
      `${second} not claimed: claude-b works on main with ${first} now`,
    );
    // Once that session ended nobody works on it: the next agent takes it over, first in line.
    endProcess(ctx.db, process.pid);
    expect(claimItem(ctx, { id: first, actor: agent('quill') }, () => T20).lease?.holder).toBe(
      'quill',
    );
  });

  // Main stays taken until what is committed there has landed: an item in review, or approved and
  // waiting for its push, still holds it; one that made no commit holds nothing.
  it('keeps main taken while an item waits for its review or its push, until it landed', () => {
    const { ctx, doing } = board();
    const first = doing('first');
    const second = doing('second');
    updateItemState(ctx.db, first, 'doit__review', now());

    const held = `${second} not claimed: ${first} is committed on main and waits for its review and its push`;
    expect(() => claimItem(ctx, { id: second, actor: agent('quill') }, now)).toThrow(held);
    const idle = nextFor(ctx, 'quill', {}, now);
    expect(idle).toMatchObject({ item: null, idle: true });
    expect(idle.text).toContain(`${second} waits to work on main: ${first} is committed there`);

    // Approved: it lands in the Subir step, which an agent does, and main stays taken until done.
    updateItemState(ctx.db, first, 'land', now());
    expect(() => claimItem(ctx, { id: second, actor: agent('quill') }, now)).toThrow(
      new RegExp(`${second} not claimed: .*${first}`),
    );
    // Landed: the next change goes ahead.
    updateItemState(ctx.db, first, 'done', now());
    expect(claimItem(ctx, { id: second, actor: agent('quill') }, now).lease?.holder).toBe('quill');
  });

  // The item being landed holds main with no agent on it too: a second item the person put above it
  // is not offered, or its commits would ride along in the landing push.
  it('keeps main taken by the item being landed, whatever the order puts above it', () => {
    const { ctx, def, doing } = board();
    const landing = doing('landing');
    updateItemState(ctx.db, landing, 'land', now());
    const above = doing('above');
    setOrder(ctx, { collection: def.name, ids: [above, landing], actor: you }, now);

    expect(() => claimItem(ctx, { id: above, actor: agent('quill') }, now)).toThrow(
      `${above} not claimed: ${landing} is committed on main and waits for its review and its push`,
    );
    expect(nextFor(ctx, 'quill', {}, now).item).toBe(landing);
  });

  it('keeps main taken by an item sent back after it was handed off once', () => {
    const { ctx, doing } = board();
    const sent = doing('sent back');
    const fresh = doing('fresh');
    appendEvent(ctx.db, {
      itemId: sent,
      type: 'transitioned',
      actor: agent('claude-b'),
      at: now(),
      data: {
        to: 'doit__review',
        tip: { branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      },
    });

    expect(() => claimItem(ctx, { id: fresh, actor: agent('quill') }, now)).toThrow(
      `${fresh} not claimed: ${sent} is committed on main`,
    );
  });

  // Field G6 day 2: the sent-back item came back to Hacerlo after its siblings, so the order put
  // them first, while its commits on main made them wait for it: nobody could take anything.
  it('offers the sent-back item first: its commits on main are what the others wait for', () => {
    const { ctx, doing } = board();
    const sent = doing('sent back');
    const second = doing('second');
    doing('third');
    appendEvent(ctx.db, {
      itemId: sent,
      type: 'transitioned',
      actor: agent('claude-b'),
      at: now(),
      data: {
        to: 'doit__review',
        tip: { branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      },
    });
    // The person sends it back: it enters Hacerlo again, later than the other two.
    appendEvent(ctx.db, {
      itemId: sent,
      type: 'transitioned',
      actor: you,
      at: now(),
      data: { to: 'doit' },
    });

    expect(nextFor(ctx, 'quill', {}, now).item).toBe(sent);
    expect(claimItem(ctx, { id: sent, actor: agent('quill') }, now).lease?.holder).toBe('quill');
    expect(() => claimItem(ctx, { id: second, actor: agent('claude-b') }, now)).toThrow(
      `${second} not claimed: quill works on main with ${sent} now`,
    );
    // Once it landed, the others go on, in the person's order.
    updateItemState(ctx.db, sent, 'done', now());
    expect(nextFor(ctx, 'claude-b', {}, now).item).toBe(second);
  });

  it('holds nothing for an item whose handoff made no commit', () => {
    const { ctx, doing } = board();
    const first = doing('first');
    const second = doing('second');
    updateItemState(ctx.db, first, 'doit__review', now());
    appendEvent(ctx.db, {
      itemId: first,
      type: 'transitioned',
      actor: agent('claude-b'),
      at: now(),
      data: {
        to: 'doit__review',
        tip: { branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40), unchanged: true },
      },
    });

    expect(claimItem(ctx, { id: second, actor: agent('quill') }, now).lease?.holder).toBe('quill');
  });
});
