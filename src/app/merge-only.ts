import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { type Resolution, resolutionAt } from './branch-files.ts';
import { requireItem } from './items.ts';
import { liveBoardOf } from './next.ts';
import type { Project } from './project.ts';
import { approvedBeforeBounce } from './tips.ts';

// An approved item comes back from its land step only because merging main conflicted: its agent
// takes it back to the step before, resolves the conflict on the branch by merging main into it,
// and hands it off again. The person approved that work already, and main's own changes landed
// through their own reviews: what is left to decide is the resolution. So the review of that round
// says it, and shows the resolution alone.
//
// Approving it is still approving the commit handed off now, exactly as for any round: the tip it
// records is the tree that lands, and the push gate holds the landing to it (app/gates.ts). Nothing
// is taken on trust: the round counts as a merge only when git finds no commit of its own in it
// (resolutionAt), so one that also changed anything else is reviewed whole.
export type MergeOnly = Resolution & { branch: string };

// The merge-only round of an item waiting for the person's review; null for any other round, or
// when git cannot tell.
export function mergeOnlyOf(project: Project, id: string): MergeOnly | null {
  const item = requireItem(project.db, id);
  const board = liveBoardOf(project, item.collection);
  const guard = board && guardedBranch(board.def);
  const position = positionOf(item.state);
  const base = guard?.guard.base;
  if (!board || !guard || base === undefined || isClosed(position) || position.phase === 'doing')
    return null;
  const lands = (state: string) => {
    const at = positionOf(state);
    return !isClosed(at) && at.phase === 'doing' && isLandStep(board.def, at.step);
  };
  const round = approvedBeforeBounce(project, id, lands);
  if (!round) return null;
  const resolution = resolutionAt(project.root, round.approved.commit, round.now.commit, base);
  return resolution ? { ...resolution, branch: round.now.branch } : null;
}

// What the agent hears at the handoff, and `show` says: this round is judged as the merge alone.
export function mergeOnlyText(id: string, merge: MergeOnly): string {
  const since = merge.since.slice(0, 7);
  const by =
    merge.files.length === 0
      ? 'nothing was changed by hand'
      : `the merge changed by hand ${merge.files.slice(0, 3).join(', ')}${
          merge.files.length > 3 ? ` and ${merge.files.length - 3} more` : ''
        }`;
  return `${id}: since the commit the person approved (${since}) this round only merges main into it, and ${by}, so the review shows that alone. Approving takes ${merge.tip.slice(0, 7)} as it is; add any other change and the whole of it is reviewed again.`;
}
