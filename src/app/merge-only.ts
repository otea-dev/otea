import { isClosed, isLandStep, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { type MergeRound, mergeDiff, mergeRoundAt } from './branch-files.ts';
import { requireItem } from './items.ts';
import { liveBoardOf } from './next.ts';
import { safeName } from './overlap.ts';
import type { Project } from './project.ts';
import { bouncedTip, recordedWith, type Tip } from './tips.ts';

// An approved item comes back from its land step only because merging main conflicted: its agent
// takes it back to the step before, resolves the conflict on the branch by merging main into it,
// and hands it off again. The person approved that work already, and main's own changes landed
// through their own reviews: what is left to decide is what the merge itself changed. So the
// review of that round says it, and shows that alone.
//
// Nothing here is taken from the agent. At the handoff, Otea itself asks the remote for the base
// (git ls-remote, not a ref of this checkout), and counts the round as a merge only when git finds
// no commit of its own in it, nothing larger than a person reads whole, no binary and no submodule
// (mergeRoundAt). What it records is commit ids, from which the diff is worked out again whenever
// it is read. Approving is still approving the commit handed off now, exactly as for any round: the
// tip it records is the tree that lands, and the push gate holds the landing to it (app/gates.ts).
export type MergeOnly = MergeRound & { branch: string; diff: string };

// The state of a step an agent lands an item in.
function landsAt(project: Project, collection: string): ((state: string) => boolean) | undefined {
  const board = liveBoardOf(project, collection);
  if (!board) return undefined;
  return (state) => {
    const at = positionOf(state);
    return !isClosed(at) && at.phase === 'doing' && isLandStep(board.def, at.step);
  };
}

// At the handoff of `tip` into a review: what the round is, when it only merges main into the work
// the person approved. Asks the remote, so it is made once, when the round is handed off.
export function mergeRoundOf(project: Project, id: string, tip: Tip): MergeRound | undefined {
  const item = requireItem(project.db, id);
  const board = liveBoardOf(project, item.collection);
  const base = board && guardedBranch(board.def)?.guard.base;
  const lands = landsAt(project, item.collection);
  if (base === undefined || !lands || tip.unchanged) return undefined;
  const approved = bouncedTip(project, id, lands);
  if (!approved || approved.branch !== tip.branch) return undefined;
  return mergeRoundAt(project.root, approved.commit, tip.commit, base);
}

// The merge-only round of an item waiting for the person's review, as its handoff recorded it; null
// for any other round, or when this checkout cannot work its diff out.
export function mergeOnlyOf(project: Project, id: string): MergeOnly | null {
  const item = requireItem(project.db, id);
  const position = positionOf(item.state);
  if (isClosed(position) || position.phase === 'doing') return null;
  const recorded = recordedWith(project, id);
  if (!recorded?.merge) return null;
  const diff = mergeDiff(project.root, recorded.merge);
  return diff === undefined ? null : { ...recorded.merge, branch: recorded.tip.branch, diff };
}

// What the agent hears at the handoff, and `show` says. Every file the merge changed is named, for
// the diff holds all of it: a merge can carry a change in a file that never conflicted.
export function mergeOnlyText(id: string, merge: MergeOnly): string {
  const since = merge.since.slice(0, 7);
  const tip = merge.tip.slice(0, 7);
  const what =
    merge.files.length === 0
      ? 'the merge itself added nothing'
      : `the merge itself changed ${merge.files.map(safeName).join(', ')}, and all of that is new and not reviewed yet, including any file that did not conflict`;
  return `${id}: since the commit the person approved (${since}) this round only merges main into it; ${what}. The review shows that alone; the rest is what was approved, and what main brought in landed through its own review. Approving takes ${tip} as it is; any other change in a round has the whole of it reviewed again.`;
}
