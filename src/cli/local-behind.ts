import { getItem } from '../app/items.ts';
import { liveBoardOf } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { approvedTipOf } from '../app/tips.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { DONE, guardedBranch } from '../core/board/model.ts';
import { type LocalBehind, localBehind } from './gitrepo.ts';

export type { LocalBehind };

// The commit a hash field names: its first word that reads as one.
const HASH = /^[0-9a-f]{7,64}$/i;

// A Done item whose work reached the remote's base while the person's main checkout did not follow
// (an agent landed with `git push origin HEAD:main` from a worktree): the item showed Done and the
// person's local main never moved, with nothing to say so (field study 3, S5). Undefined when it
// followed, the item is not Done on a board with a protected base, or there is no remote.
export function localBehindOf(project: Project, id: string): LocalBehind | undefined {
  const item = getItem(project, id);
  const position = positionOf(item.state);
  if (!isClosed(position) || position.closed !== DONE) return undefined;
  const board = liveBoardOf(project, item.collection);
  const guard = board ? guardedBranch(board.def) : undefined;
  const base = guard?.guard.base;
  if (!guard || base === undefined) return undefined;
  const written = guard.guard.commit === undefined ? undefined : item.fields[guard.guard.commit];
  const named =
    typeof written === 'string'
      ? written.split(/[\s,;]+/).find((word) => HASH.test(word))
      : undefined;
  const branch = String(item.fields[guard.id] ?? '').trim();
  const commit = named ?? (branch === '' ? undefined : approvedTipOf(project, id, branch)?.commit);
  if (commit === undefined) return undefined;
  return localBehind(project.root, base, commit);
}

// What the agent hands on to the person, in plain words.
export function localBehindText(id: string, behind: LocalBehind): string {
  const commits = `${behind.behind} commit${behind.behind === 1 ? '' : 's'}`;
  const how =
    behind.state === 'ready'
      ? `run git pull --ff-only in ${behind.checkout} to bring it up to date`
      : behind.state === 'changes'
        ? `that checkout has changes of its own, so it was left alone: run git pull --ff-only there when you can`
        : `that checkout is on ${behind.on ?? 'another branch'}, so it was left alone: git switch ${behind.base} and git pull --ff-only when you can`;
  return `${id} landed on ${behind.remote}, but your local ${behind.base} is ${commits} behind it (the checkout at ${behind.checkout}): ${how}.`;
}
