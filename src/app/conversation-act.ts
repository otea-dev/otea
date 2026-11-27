import { isClosed, positionOf } from '../core/board/engine.ts';
import { SAME, stepById } from '../core/board/model.ts';
import type { Message, MessageAction } from '../core/conversation.ts';
import { OteaError } from '../core/errors.ts';
import type { Surface } from '../core/surface.ts';
import { isAnswered, selectMessage } from '../store/conversation.ts';
import { joinTransaction } from '../store/database.ts';
import {
  answerSecretaryQuestion,
  type GivenAnswer,
  type Said,
  type SayInput,
  sayAsSecretary,
} from './conversation.ts';
import { type Clock, getItem, requireItem, systemClock } from './items.ts';
import { itemOnBoard, liveBoardOf, sendBackItem } from './next.ts';
import type { Project } from './project.ts';

// The cards of the secretary's that carry an action (field study 4, a change of mind on an item
// already in the person's review): the secretary drafts the note and asks, the person's tap
// performs the send-back as the person, exactly as the desk's Devolver does. Kept apart from
// app/conversation.ts, which the items' own modules read: this one moves items.

// Whether the item waits for the person's review right now: the only place a send-back is theirs.
// Returns the round of the review, which the card is bound to, and the step a send-back goes to.
function assertInReview(project: Project, id: string): { round: number; to: string } {
  const item = getItem(project, id);
  const board = liveBoardOf(project, item.collection);
  const at = positionOf(item.state);
  if (board === undefined || isClosed(at) || at.phase !== 'review' || item.turn !== 'human') {
    throw new OteaError(
      'invalid_transition',
      `${id} is not waiting for your review (it is ${item.state}), so there is nothing to send back. If it is not handed in yet, change it with otea update ${id}`,
    );
  }
  const step = stepById(board.def, at.step);
  const back =
    step === undefined ? undefined : stepById(board.def, step.back === SAME ? step.id : step.back);
  return {
    round: itemOnBoard(project, requireItem(project.db, id), board.def).round,
    to: back?.name ?? step?.name ?? at.step,
  };
}

export type SayWithSendBack = Omit<SayInput, 'action'> & {
  action?: Omit<MessageAction, 'round' | 'to'>;
};

// The secretary asks the person to send an item back with a note: the card says what is proposed,
// and nothing moves until the person taps. Refused for an item that is not in their review now.
// The card keeps the round it was asked in: it is about that delivery only.
export function sayWithSendBack(
  project: Project,
  input: SayWithSendBack,
  now: Clock = systemClock,
): Said {
  const { action, ...rest } = input;
  if (action === undefined) return sayAsSecretary(project, rest, now);
  const { round, to } = assertInReview(project, action.item);
  return sayAsSecretary(project, { ...rest, action: { ...action, round, to } }, now);
}

// The person's answer to a question of the secretary's. When the question carries an action and the
// person taps its first option, Otea sends the item back for them (the note the secretary drafted,
// or the one they edited) in the same step that records their answer, so an item that moved on
// since is refused and nothing is recorded. The person is the actor of the send-back, from the
// surface they tapped on.
export function answerSecretaryTap(
  project: Project,
  id: number,
  given: GivenAnswer,
  now: Clock = systemClock,
  by = 'human',
  surface?: Surface,
): Message {
  return joinTransaction(project.db, () => {
    const question = selectMessage(project.db, id);
    const action = question?.author === 'secretary' ? question.action : null;
    if (action !== null && given.option === 1 && !isAnswered(project.db, id)) {
      const { round } = assertInReview(project, action.item);
      if (round !== action.round) {
        throw new OteaError(
          'invalid_transition',
          `${action.item} was sent back and handed in again since this was asked (round ${action.round}, now ${round}): the note was about the earlier delivery. Nothing was sent back; ask the secretary again or send it back from the item`,
        );
      }
      const note = (given.note ?? action.note).trim();
      if (note === '') {
        throw new OteaError('reason_required', 'Say what to change before you send it back');
      }
      sendBackItem(
        project,
        {
          id: action.item,
          actor: { kind: 'human', name: by },
          channel: 'ui',
          reason: note,
          ...(surface === undefined ? {} : { surface }),
        },
        now,
      );
    }
    return answerSecretaryQuestion(project, id, given, now, by);
  });
}
