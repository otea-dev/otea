import { getItem } from '../app/items.ts';
import type { Project } from '../app/project.ts';
import { repeatedRound } from '../app/tips.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';

// A round sent back for a change whose handoff holds the same files as the round before (P5-F2): an
// empty commit and the old diff were handed off, the review said nothing and the person could
// approve a change that never happened. `tip` is the commit handed off now, `earlier` the one of
// round number `round`, whose files it holds again.
export type RoundSame = { branch: string; tip: string; earlier: string; round: number };

// The warning of an item waiting for the person's review; null while it is not in review, its
// handoff recorded no tip, or its work is not what an earlier round handed off. Approving stays
// theirs: an answer to a question may change no file.
export function roundSame(project: Project, id: string): RoundSame | null {
  const position = positionOf(getItem(project, id).state);
  if (isClosed(position) || position.phase === 'doing') return null;
  const same = repeatedRound(project, id);
  return same
    ? {
        branch: same.tip.branch,
        tip: same.tip.commit.slice(0, 7),
        earlier: same.commit.slice(0, 7),
        round: same.round,
      }
    : null;
}
