import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../core/board/templates.ts';
import { updateItemState } from '../store/queries.ts';
import { createItem, getItem, moveItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem, landWaitOf, liveBoardOf, nextFor } from './next.ts';
import { scanned } from './overlap.ts';
import { pendingOf, pendingText } from './pending.ts';
import { stepFactsOf } from './step-facts.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const quill = { kind: 'agent' as const, name: 'quill' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 27, 9, 0, tick++)).toISOString();

// Field studies 4 and 5 (u6, V2, V4): items whose branches change the same files, approved
// together, landed one after the other and the later ones bounced back for another review each
// time (API-7 three times, the same README three times). The person's approval of an item that
// overlaps one still to land now waits for it; when it lands, the item's agent merges main into
// the item first and the person reviews that merge once.
function board() {
  const ctx = memoryContext();
  const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
  publishAs(ctx, def, 'bcam', now);
  const pushed: Record<string, string[]> = {};
  ctx.changed = (branch) => pushed[branch];
  // An item in the person's review of its work, its branch pushed with the files it changes.
  const inReview = (title: string, files: string[]) => {
    pushed[`cambio/${title}`] = files;
    const { id } = createItem(
      ctx,
      {
        collection: def.name,
        title,
        fields: { want: 'x', branch: `cambio/${title}`, commit: 'abc1234' },
        actor: you,
      },
      now,
    );
    updateItemState(ctx.db, id, 'doit__review', now());
    return id;
  };
  const approve = (id: string) => moveItem(ctx, { id, to: 'land', actor: you, channel: 'ui' }, now);
  const lands = (id: string) => updateItemState(ctx.db, id, 'done', now());
  const waitOf = (id: string) => landWaitOf(scanned(ctx), getItem(ctx, id), now());
  const facts = (id: string) => {
    const item = getItem(ctx, id);
    return stepFactsOf(liveBoardOf(ctx, item.collection)?.def, item, item.events);
  };
  // The agent that landed it finds a merge to make and takes it back to its work step.
  const takeBack = (id: string) => {
    claimItem(ctx, { id, actor: quill }, now);
    handoffItem(
      ctx,
      { id, actor: quill, channel: 'cli', way: 'doit', reason: 'merged main: review the merge' },
      now,
    );
  };
  return { ctx, inReview, approve, lands, waitOf, facts, takeBack };
}

describe('approving an item that overlaps one still to land', () => {
  it('waits for it, saying which, and is not offered to an agent meanwhile', () => {
    const { ctx, inReview, approve, waitOf } = board();
    const first = inReview('first', ['src/shared.ts']);
    const second = inReview('second', ['src/shared.ts', 'src/own.ts']);
    approve(first);
    approve(second);

    expect(waitOf(second)).toMatchObject({ first, overlap: true });
    expect(waitOf(first)).toBeUndefined();
    expect(() => claimItem(ctx, { id: second, actor: quill }, now)).toThrow(
      `${second} not claimed: ${first} lands in main first`,
    );
    expect(nextFor(ctx, 'quill', {}, now).item).toBe(first);
  });

  it('is told to merge main first once it landed, and goes back for one review, not a bounce', () => {
    const { ctx, inReview, approve, lands, facts } = board();
    const first = inReview('first', ['src/shared.ts']);
    const second = inReview('second', ['src/shared.ts']);
    approve(first);
    approve(second);
    lands(first);

    const next = nextFor(ctx, 'quill', { claim: true }, now);
    expect(next.item).toBe(second);
    expect(next.text).toContain(`${first} landed first`);
    expect(next.text).toContain('merge main into its branch');
    expect(next.text).toContain('otea handoff');

    // Landing it as it is, with no review of the merge, is refused: the person reviews it once.
    expect(() =>
      handoffItem(ctx, { id: second, actor: quill, channel: 'cli', way: 'done' }, now),
    ).toThrow(/review/);

    // It goes back for that review with no bounce to read: the card says it merges what landed.
    handoffItem(
      ctx,
      { id: second, actor: quill, channel: 'cli', way: 'doit', reason: 'merged main' },
      now,
    );
    expect(facts(second)).toEqual({ merging: { after: [first] } });
  });

  it('holds the next of a chain until the one before has come back and landed', () => {
    const { ctx, inReview, approve, lands, waitOf, facts, takeBack } = board();
    const a = inReview('a', ['src/shared.ts']);
    const b = inReview('b', ['src/shared.ts']);
    const c = inReview('c', ['src/shared.ts']);
    approve(a);
    approve(b);
    approve(c);
    expect(waitOf(c)).toMatchObject({ first: a, overlap: true });

    // a lands; b, released, merges and goes back to the person's review.
    lands(a);
    expect(waitOf(c)).toMatchObject({ first: b, overlap: true });
    takeBack(b);
    expect(facts(b)).toEqual({ merging: { after: [a] } });
    updateItemState(ctx.db, b, 'doit__review', now());
    // c still waits: if it merged now, b landing would conflict with it, and it would come back.
    expect(waitOf(c)).toMatchObject({ first: b, overlap: true });
    expect(() => claimItem(ctx, { id: c, actor: quill }, now)).toThrow(`${b} lands in main first`);

    // The person approves b's merge; b lands; only then c goes on, with both landed ahead of it.
    approve(b);
    expect(waitOf(c)).toMatchObject({ first: b });
    lands(b);
    expect(waitOf(c)).toBeUndefined();
    const next = nextFor(ctx, 'quill', { claim: true }, now);
    expect(next.item).toBe(c);
    expect(next.text).toContain(`${a} and ${b} landed first`);
  });

  it('changes nothing for items that share no file', () => {
    const { ctx, inReview, approve, lands, waitOf } = board();
    const first = inReview('first', ['src/a.ts']);
    const second = inReview('second', ['src/b.ts']);
    approve(first);
    approve(second);

    expect(waitOf(second)?.overlap).toBeUndefined();
    lands(first);
    const next = nextFor(ctx, 'quill', { claim: true }, now);
    expect(next.item).toBe(second);
    expect(next.text).not.toContain('landed first');
    // It lands straight, no review of a merge asked.
    expect(() =>
      handoffItem(ctx, { id: second, actor: quill, channel: 'cli', way: 'done' }, now),
    ).not.toThrow();
  });

  it('is released to land as any other when the one ahead is sent back or dropped', () => {
    const sent = board();
    const first = sent.inReview('first', ['src/shared.ts']);
    const second = sent.inReview('second', ['src/shared.ts']);
    sent.approve(first);
    sent.approve(second);
    moveItem(
      sent.ctx,
      { id: first, to: 'doit', actor: you, channel: 'ui', reason: 'one more case' },
      now,
    );

    expect(sent.waitOf(second)).toBeUndefined();
    const next = nextFor(sent.ctx, 'quill', { claim: true }, now);
    expect(next.item).toBe(second);
    expect(next.text).not.toContain('landed first');
    expect(() =>
      handoffItem(sent.ctx, { id: second, actor: quill, channel: 'cli', way: 'done' }, now),
    ).not.toThrow();

    const dropped = board();
    const a = dropped.inReview('a', ['src/shared.ts']);
    const b = dropped.inReview('b', ['src/shared.ts']);
    dropped.approve(a);
    dropped.approve(b);
    updateItemState(dropped.ctx.db, a, 'dropped', now());

    expect(dropped.waitOf(b)).toBeUndefined();
    expect(nextFor(dropped.ctx, 'quill', { claim: true }, now).text).not.toContain('landed first');
  });

  it('is said in `otea pending` and the secretary reads no bounce in it', () => {
    const { ctx, inReview, approve, lands, takeBack } = board();
    const first = inReview('first', ['src/shared.ts']);
    const second = inReview('second', ['src/shared.ts']);
    approve(first);
    approve(second);

    const waiting = pendingText(pendingOf(ctx, now, { blocks: true }));
    expect(waiting).toContain(`${second} approved, waits for ${first} to land first`);
    expect(waiting).not.toContain('came back after approval');

    lands(first);
    takeBack(second);
    const back = pendingText(pendingOf(ctx, now, { blocks: true }));
    expect(back).toContain(`${second} is merging main after ${first} landed ahead of it`);
    expect(back).not.toContain('came back after approval');
  });

  it('frees what waits for an item that came back when the person sends it back', () => {
    const { ctx, inReview, approve, lands, waitOf, takeBack } = board();
    const a = inReview('a', ['src/shared.ts']);
    const b = inReview('b', ['src/shared.ts']);
    const c = inReview('c', ['src/shared.ts']);
    approve(a);
    approve(b);
    approve(c);
    lands(a);
    takeBack(b);
    updateItemState(ctx.db, b, 'doit__review', now());
    expect(waitOf(c)).toMatchObject({ first: b });

    // The person sends b's merge back with a comment: it holds nothing up any more.
    moveItem(ctx, { id: b, to: 'doit', actor: you, channel: 'ui', reason: 'one more case' }, now);

    expect(waitOf(c)).toBeUndefined();
  });

  it('keeps a bounce it did not wait for as a bounce', () => {
    const { inReview, approve, facts, takeBack } = board();
    const only = inReview('only', ['src/a.ts']);
    approve(only);
    takeBack(only);

    expect(facts(only)).toMatchObject({ bounced: expect.objectContaining({ by: 'quill' }) });
    expect(facts(only)).not.toHaveProperty('merging');
  });
});
