import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../core/item.ts';
import { addCollection } from './collections.ts';
import type { Context } from './context.ts';
import { createItem, getItem, moveItem } from './items.ts';
import { claimItem } from './leases.ts';
import { type RelayInput, relayDecision } from './relay.ts';
import { memoryContext } from './testing.ts';

const claude: Actor = { kind: 'agent', name: 'claude' };
const codex: Actor = { kind: 'agent', name: 'codex' };
const human: Actor = { kind: 'human', name: 'human' };

const T0 = '2026-01-01T00:00:00.000Z';
const T5 = '2026-01-01T00:05:00.000Z';

const at = (time: string) => () => time;

// A relay is words an agent says the person said: it moves nothing that cannot be taken back (it
// never drops, finishes or approves). Bug triage's verify step is the person's, and sending a fix
// back to fixing is one such move.
describe('relayDecision', () => {
  let ctx: Context;

  const item = () => getItem(ctx, 'BUGS-1', at(T5));
  const relay = (input: Partial<RelayInput> = {}) =>
    relayDecision(
      ctx,
      {
        id: 'BUGS-1',
        to: 'fixing',
        via: 'claude',
        channel: 'cli',
        quote: 'Send it back, it still crashes',
        reason: 'Still crashes',
        ...input,
      },
      at(T5),
    );
  const move = (to: string, actor = claude, reason?: string) =>
    moveItem(
      ctx,
      { id: 'BUGS-1', to, actor, channel: 'cli', ...(reason ? { reason } : {}) },
      at(T0),
    );

  beforeEach(() => {
    ctx = memoryContext();
    addCollection(ctx, { name: 'bugs', preset: 'bug-triage' });
    createItem(ctx, { collection: 'bugs', title: 'First', actor: claude }, at(T0));
    // Another agent did the work: an agent relays only decisions on work it did not do itself.
    ctx.db.exec("UPDATE items SET state = 'fixing'");
    move('verify', codex, 'Fixed');
  });

  afterEach(() => ctx.db.close());

  it('moves the item as the human, recording the relaying agent, the source and the quote', () => {
    const moved = relay();

    expect(moved).toMatchObject({ state: 'fixing', turn: 'agent', updatedAt: T5 });
    expect(item().events.at(-1)).toMatchObject({
      type: 'transitioned',
      actor: human,
      at: T5,
      data: {
        from: 'verify',
        to: 'fixing',
        reason: 'Still crashes',
        channel: 'cli',
        via: 'claude',
        source: 'conversation',
        quote: 'Send it back, it still crashes',
      },
    });
  });

  it('refuses a decision on work the relaying agent did itself, with own_step details', () => {
    expect(() => relay({ via: 'codex' })).toThrow(
      expect.objectContaining({
        code: 'forbidden',
        details: { kind: 'own_step', item: 'BUGS-1', step: 'fixing', who: 'codex' },
      }),
    );
    expect(item().state).toBe('verify');
    expect(relay()).toMatchObject({ state: 'fixing' });
  });

  it('records the channel the relaying agent used', () => {
    relay({ channel: 'mcp' });

    expect(item().events.at(-1)?.data.channel).toBe('mcp');
  });

  it('trims the quote it records', () => {
    relay({ quote: '  yes, send it back \n' });

    expect(item().events.at(-1)?.data.quote).toBe('yes, send it back');
  });

  it.each(['', '   '])('requires a quote (%j) with quote_required, writing nothing', (quote) => {
    expect(() => relay({ quote })).toThrow(expect.objectContaining({ code: 'quote_required' }));
    expect(item()).toMatchObject({ state: 'verify', updatedAt: T0 });
  });

  it('requires two words in the quote: a bare yes is no decision', () => {
    expect(() => relay({ quote: 'yes' })).toThrow(
      expect.objectContaining({ code: 'quote_required' }),
    );
    expect(item().state).toBe('verify');
  });

  it('requires a reason when the transition does; the quote does not stand in for it', () => {
    expect(() => relay({ reason: '' })).toThrow(
      expect.objectContaining({ code: 'reason_required' }),
    );
    expect(item().state).toBe('verify');
  });

  it('refuses a human-ui transition with forbidden, writing nothing', () => {
    expect(() => relay({ to: 'fixed' })).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(item().events).toHaveLength(2);
  });

  it('refuses an agent transition with not_relayable', () => {
    ctx.db.exec("UPDATE items SET state = 'accepted'");

    expect(() => relay({ to: 'fixing' })).toThrow(
      expect.objectContaining({ code: 'not_relayable' }),
    );
  });

  it('rejects an undeclared transition and an unknown item', () => {
    expect(() => relay({ to: 'reported' })).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
    expect(() => relay({ id: 'BUGS-9' })).toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  it('relays from reported on the human transition, not the agent one', () => {
    createItem(ctx, { collection: 'bugs', title: 'Vague', actor: claude }, at(T0));
    ctx.db.exec(`UPDATE items SET state = 'reported' WHERE id = 'BUGS-2'`);

    relay({ id: 'BUGS-2', to: 'accepted' });

    expect(getItem(ctx, 'BUGS-2', at(T5)).events.at(-1)?.actor).toEqual(human);
  });

  describe('on an item another agent holds', () => {
    beforeEach(() => {
      createItem(ctx, { collection: 'bugs', title: 'Held', actor: claude }, at(T0));
      ctx.db.exec(`UPDATE items SET state = 'accepted' WHERE id = 'BUGS-2'`);
      claimItem(ctx, { id: 'BUGS-2', actor: codex }, at(T0));
      ctx.db.exec(`UPDATE items SET state = 'reported' WHERE id = 'BUGS-2'`);
    });

    it('is not blocked, like the human in the ui', () => {
      const moved = relay({ id: 'BUGS-2', to: 'accepted', reason: 'Fine' });

      expect(moved).toMatchObject({ state: 'accepted' });
      expect(getItem(ctx, 'BUGS-2', at(T5)).events.at(-1)).toMatchObject({
        type: 'transitioned',
        actor: human,
        data: { via: 'claude', source: 'conversation' },
      });
    });
  });
});
