import type { Channel } from '../core/authority.ts';
import { isAsked, isClosed, positionOf } from '../core/board/engine.ts';
import { isEvidence, type Part, partOf, stepById } from '../core/board/model.ts';
import { EVIDENCE_WAIVED, type Waiver } from '../core/board/waivers.ts';
import { OteaError } from '../core/errors.ts';
import type { Actor } from '../core/item.ts';
import { appendEvent } from '../store/queries.ts';
import { requireWritableItem, systemClock } from './items.ts';
import { itemOnBoard, liveBoardOf } from './next.ts';
import type { Project } from './project.ts';

export type WaiveInput = {
  id: string;
  // The file part (screenshots, video, a log...), by name or id.
  part: string;
  reason?: string;
  actor: Actor;
  channel: Channel;
};

export type Waived = { part: string; waiver: Waiver; text: string };

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// The person lets one item go on without a file its step asks for, when the agent has no way to
// make it (no browser for a screenshot): the handoff then passes, and the review shows the person
// waived it. Only the person does this: an agent may not waive what is asked of it.
export function waiveEvidence(project: Project, input: WaiveInput, now = systemClock): Waived {
  const item = requireWritableItem(project.db, input.id);
  if (input.actor.kind !== 'human')
    throw new OteaError(
      'forbidden',
      `Not waived on ${item.id}: only the person waives a file a step asks for. Ask them with otea ask`,
    );
  const board = liveBoardOf(project, item.collection);
  if (!board) throw new OteaError('invalid_type', `${item.id} is not on a board`);
  const { def } = board;
  const position = positionOf(item.state);
  if (isClosed(position))
    throw new OteaError('item_closed', `${item.id} is closed: nothing to waive`);
  // Only a file the step the item stands on asks for now: that step's hand, as its facts hold.
  const facts = itemOnBoard(project, item, def).facts;
  const asked = (stepById(def, position.step)?.hand ?? [])
    .filter((hand) => isAsked(def, facts, hand))
    .map(({ ref }) => partOf(def, ref))
    .filter((each): each is Part => each !== undefined && isEvidence(each));
  const part = asked.find((each) => each.id === input.part || fold(each.name) === fold(input.part));
  if (!part)
    throw new OteaError(
      'not_found',
      `${item.id} is asked for no file "${input.part}" at this step; it asks for ${asked.map(({ name }) => name).join(', ') || 'none'}`,
    );
  const reason = input.reason?.trim() ?? '';
  const at = now();
  appendEvent(project.db, {
    itemId: item.id,
    type: EVIDENCE_WAIVED,
    actor: input.actor,
    at,
    data: {
      part: part.id,
      name: part.name,
      ...(reason === '' ? {} : { reason }),
      channel: input.channel,
    },
  });
  const waiver: Waiver = {
    part: part.id,
    name: part.name,
    ...(reason === '' ? {} : { reason }),
    at,
    by: input.actor.name,
  };
  return {
    part: part.name,
    waiver,
    text: `Waived ${part.name} on ${item.id}${reason === '' ? '' : `: ${reason}`}. Its handoff no longer asks for it.`,
  };
}
