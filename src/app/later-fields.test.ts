import { describe, expect, it } from 'vitest';
import { cambios, step } from '../core/board/testing.ts';
import { OteaError } from '../core/errors.ts';
import { updateItemState } from '../store/queries.ts';
import { createItem, showItem, updateItem } from './items.ts';
import { memoryContext, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'fede' };
const kiln = { kind: 'agent' as const, name: 'kiln' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 12, 9, 0, tick++)).toISOString();

// Cambios hands Plan in Analizar and nothing in Ejecutar; Commit is handed only by Ejecutar.
function board() {
  const ctx = memoryContext();
  const def = cambios();
  def.parts.fcommit = { id: 'fcommit', name: 'Commit', kind: 'text', hint: '', options: [] };
  def.steps = [
    step('sanalyse', 'Analizar', { hand: [{ ref: 'fplan', req: 'always', fresh: false }] }),
    step('sexec', 'Ejecutar', { hand: [{ ref: 'fcommit', req: 'always', fresh: false }] }),
  ];
  delete def.split;
  publishAs(ctx, def, 'bcam', now);
  const { id } = createItem(
    ctx,
    { collection: 'Cambios', title: 'Nube', fields: { fwhat: 'x' }, actor: you },
    now,
  );
  return { ctx, id };
}

const refusal = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    if (error instanceof OteaError) return error;
    throw error;
  }
  return undefined;
};

// A reviewer reads what the step handed off (P1-F3): a field only a later step hands stays as it
// is while the item waits in review, whoever writes it, so no value that is not true yet shows.
describe('a field of a later step during a review', () => {
  it.each([
    ['the person', you],
    ['an agent', kiln],
  ])('is refused for %s, naming the field, the step that hands it and the review', (_, actor) => {
    const { ctx, id } = board();
    updateItemState(ctx.db, id, 'sanalyse__review', now());

    const error = refusal(() =>
      updateItem(ctx, { id, fields: { fcommit: 'abc1234' }, actor }, now),
    );

    expect(error?.message).toBe(
      `Not updated ${id}: Commit is filled in Ejecutar, a later step, so it stays as it is while Analizar is in review; fill it once the item gets there.`,
    );
    expect(error?.details).toEqual({
      kind: 'later_field',
      item: id,
      part: 'Commit',
      step: 'Ejecutar',
      review: 'Analizar',
    });
    expect(showItem(ctx, id, { actor: you, channel: 'ui' }, now).fields.fcommit).toBeUndefined();
  });

  it('lets a field of the step under review, of the form or of no step change', () => {
    const { ctx, id } = board();
    updateItemState(ctx.db, id, 'sanalyse__review', now());

    expect(() =>
      updateItem(ctx, { id, fields: { fplan: 'p', fwhat: 'y' }, actor: you }, now),
    ).not.toThrow();
  });

  it('lets the later field change while its own step is being done, and while the earlier one is', () => {
    const { ctx, id } = board();
    expect(() => updateItem(ctx, { id, fields: { fcommit: 'a' }, actor: kiln }, now)).not.toThrow();

    updateItemState(ctx.db, id, 'sexec', now());
    expect(() => updateItem(ctx, { id, fields: { fcommit: 'b' }, actor: kiln }, now)).not.toThrow();
  });
});
