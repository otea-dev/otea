import { isClosed, positionOf } from '../core/board/engine.ts';
import { OteaError } from '../core/errors.ts';
import type { FieldValues } from '../core/fields.ts';
import type { Actor } from '../core/item.ts';
import { joinTransaction } from '../store/database.ts';
import { requireAssistant } from './assistant.ts';
import { getItem, type Item, systemClock, updateItem } from './items.ts';
import { liveBoardOf } from './next.ts';
import { agentStepOf, relayChange } from './notes.ts';
import type { Project } from './project.ts';

export type UpdateAndTell = {
  id: string;
  title?: string;
  fields?: FieldValues;
  // What changed, in one line, as the worker reads it.
  tell: string;
  actor: Actor;
};

// The person changed their mind about an item that is not in their review yet: the assistant
// reshapes it and the worker on it hears at once (a note it answers before it hands off, waking its
// wait and printed by its next calls), instead of the change waiting behind the newer messages.
// One act: a change that cannot be told is not made. An item in the person's review is theirs: it is
// not changed under them (ask them with a card, otea say --send-back).
export function updateAndTell(
  project: Project,
  input: UpdateAndTell,
  now: () => string = systemClock,
): Item {
  requireAssistant(project.db, input.actor.name, 'tells a worker what the person changed');
  return joinTransaction(project.db, () => {
    const item = getItem(project, input.id);
    const at = positionOf(item.state);
    if (liveBoardOf(project, item.collection) && !isClosed(at) && at.phase === 'review') {
      throw new OteaError(
        'invalid_transition',
        `${input.id} is in the person's review: it does not change under them. Ask them to send it back, in one tap: otea say "<question>" --send-back ${input.id} --note "<their change, in their words>" --option "<send it back>" --option "<leave it>"`,
      );
    }
    const hasChange = input.title !== undefined || Object.keys(input.fields ?? {}).length > 0;
    const changed = hasChange
      ? updateItem(
          project,
          {
            id: input.id,
            actor: input.actor,
            // Over a worker's lease only where the worker can be told: a change that cannot be told
            // is not made (an item of no board, or not in an agent's step, keeps its lease check).
            ...(agentStepOf(project, item) === undefined ? {} : { overLease: true as const }),
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.fields === undefined ? {} : { fields: input.fields }),
          },
          now,
        )
      : item;
    relayChange(
      project,
      { id: input.id, text: input.tell, actor: input.actor, channel: 'cli', role: 'assistant' },
      now,
    );
    return changed;
  });
}
