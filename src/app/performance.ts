import {
  type ItemTrail,
  modelPerformance,
  PERIOD_HINT,
  type PerformanceView,
  parsePeriod,
} from '../core/board/performance.ts';
import { OteaError } from '../core/errors.ts';
import { selectEvents, selectItems } from '../store/queries.ts';
import { getCollection } from './collections.ts';
import type { Context } from './context.ts';
import { type Clock, systemClock } from './items.ts';
import { liveBoards } from './next.ts';

// How each model performs on the project's live boards (core/board/performance.ts), read by the
// server's /api/performance, the Rendimiento view and otea stats alike.

export type PerformanceInput = {
  // A board by its name, in any case; every live board when left out.
  board?: string | undefined;
  // A period back from now (7d, 30d, 12h) or all; all when left out.
  since?: string | undefined;
};

export function performanceOf(
  ctx: Context,
  input: PerformanceInput,
  now: Clock = systemClock,
): PerformanceView {
  const period = parsePeriod(input.since ?? 'all', now());
  if (!period) throw new OteaError('invalid_fields', `--since takes ${PERIOD_HINT}`);
  const only = input.board === undefined ? undefined : getCollection(ctx.db, input.board).name;
  const boards = liveBoards(ctx).filter(({ collection }) => !only || collection === only);
  if (only && boards.length === 0) {
    throw new OteaError('not_found', `Board "${only}" is not published yet`);
  }
  return {
    ...modelPerformance(trailsOf(ctx, boards), period),
    boards: boards.map(({ collection }) => collection),
    since: period.since ?? null,
  };
}

type LiveBoard = ReturnType<typeof liveBoards>[number];

// The trails of the items on the boards given. `label` names a board and `own` an item where two
// projects are read together: ids and board names repeat from one project to the next.
function trailsOf(
  ctx: Context,
  boards: readonly LiveBoard[],
  label: (board: string) => string = (board) => board,
  own: (item: string) => string = (item) => item,
): ItemTrail[] {
  return boards.flatMap(({ collection, def }) =>
    selectItems(ctx.db, { collection }).map(
      (item): ItemTrail => ({
        item: own(item.id),
        board: label(collection),
        def,
        events: selectEvents(ctx.db, item.id),
        start: { initial: def.steps[0]?.id ?? item.state, createdAt: item.createdAt },
      }),
    ),
  );
}

// How each model performs over every project given (P6-F3): the same report, read from all their
// boards at once, so a model's numbers are one row whichever project it worked in. A board goes by
// «Project / board», an item by its project, for neither repeats in the other.
export function performanceAcross(
  projects: readonly { id: string; name: string; ctx: Context }[],
  input: { since?: string | undefined },
  now: Clock = systemClock,
): PerformanceView {
  const period = parsePeriod(input.since ?? 'all', now());
  if (!period) throw new OteaError('invalid_fields', `--since takes ${PERIOD_HINT}`);
  const read = projects.map(({ id, name, ctx }) => {
    const boards = liveBoards(ctx);
    const label = (board: string) => `${name} / ${board}`;
    return {
      boards: boards.map(({ collection }) => label(collection)),
      trails: trailsOf(ctx, boards, label, (item) => `${id}:${item}`),
    };
  });
  return {
    ...modelPerformance(
      read.flatMap(({ trails }) => trails),
      period,
    ),
    boards: read.flatMap(({ boards }) => boards),
    since: period.since ?? null,
  };
}
