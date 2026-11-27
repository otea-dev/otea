import type { Channel } from '../core/authority.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { DROPPED } from '../core/board/model.ts';
import { OteaError } from '../core/errors.ts';
import type { Actor } from '../core/item.ts';
import type { Surface } from '../core/surface.ts';
import { transaction } from '../store/database.ts';
import { appendEvent, selectEvents, updateItemState } from '../store/queries.ts';
import { typeOfItem } from './collections.ts';
import type { Context } from './context.ts';
import {
  type Clock,
  type Item,
  present,
  requireWritableItem,
  stateNames,
  systemClock,
} from './items.ts';

// The person takes back a discard, whenever they see it was wrong (field study 4, U8: an item left
// their review by a sentence they never said and nothing on the desk brought it back): the item
// returns to the state it left, outside the workflow's moves, as an event that names the discard it
// undoes. Only the person, from the desk; the undo of a move (undo.ts) lasts as long as its toast.
export type ReopenDroppedInput = {
  id: string;
  actor: Actor;
  channel: Channel;
  surface?: Surface;
};

export function reopenDropped(
  ctx: Context,
  input: ReopenDroppedInput,
  now: Clock = systemClock,
): Item {
  const { db } = ctx;
  return transaction(db, () => {
    const item = requireWritableItem(db, input.id);
    const position = positionOf(item.state);
    if (!isClosed(position) || position.closed !== DROPPED) {
      throw new OteaError('invalid_transition', `${item.id} is not dropped: nothing to reopen`);
    }
    const last = selectEvents(db, item.id)
      .filter((event) => event.type === 'transitioned')
      .at(-1);
    if (!last || last.data.to !== item.state || typeof last.data.from !== 'string') {
      throw new OteaError(
        'invalid_transition',
        `${item.id} did not leave an open state by a drop: nothing to reopen it to`,
      );
    }
    const { workflow } = typeOfItem(ctx, item);
    const back = last.data.from;
    const at = now();
    updateItemState(db, item.id, back, at);
    appendEvent(db, {
      itemId: item.id,
      type: 'transitioned',
      actor: input.actor,
      at,
      data: {
        from: item.state,
        to: back,
        ...stateNames(workflow, { from: item.state, to: back }),
        reopened: true,
        undoes: last.id,
        channel: input.channel,
        ...(input.surface === undefined ? {} : { surface: input.surface }),
      },
    });
    return present({ ...item, state: back, updatedAt: at }, workflow, at);
  });
}
