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
  if (behind.local) return localOnlyText(id, behind, commits);
  // Nothing here is one more command away: the local base has commits of its own the remote lacks,
  // so it is the person's to untangle (an agent never merges or resets there).
  if (behind.state === 'diverged') {
    return `${id} landed on ${behind.remote}, but your local ${behind.base} (the checkout at ${behind.checkout}) and ${behind.remote} have diverged: ${behind.remote} has ${commits} yours lacks, and your ${behind.base} has commits of its own that ${behind.remote} lacks, so it was left alone and no fast-forward can bring it up to date. Look at git log ${behind.remote}..${behind.base} and decide with the person (a merge or a rebase is theirs to choose).`;
  }
  const how =
    behind.state === 'ready'
      ? `otea land sync ${id} brings it up to date (or git pull --ff-only in ${behind.checkout})`
      : behind.state === 'changes'
        ? `that checkout has changes of its own, so it was left alone: run git pull --ff-only there when you can`
        : behind.state === 'collides'
          ? `${behind.paths?.join(', ') ?? 'a file'} would replace ${behind.paths?.length === 1 ? 'a file' : 'files'} you keep out of git in that checkout, so it was left alone: move ${behind.paths?.length === 1 ? 'it' : 'them'} aside, then run git pull --ff-only there`
          : `that checkout is on ${behind.on ?? 'another branch'}, so it was left alone: git switch ${behind.base} and git pull --ff-only when you can`;
  return `${id} landed on ${behind.remote}, but your local ${behind.base} is ${commits} behind it (the checkout at ${behind.checkout}): ${how}.`;
}

// The same, for a repo with no remote: the work landed in a worktree's branch, and nothing was
// pushed anywhere, so the person's base is behind the landed commit itself.
function localOnlyText(id: string, behind: LocalBehind, commits: string): string {
  const where = `your local ${behind.base} (the checkout at ${behind.checkout})`;
  if (behind.state === 'diverged') {
    return `${id} landed in its branch, but ${where} has commits of its own that the landed work does not hold, so it was left alone and no fast-forward can bring it up to date. Look at git log and decide with the person (a merge or a rebase is theirs to choose).`;
  }
  const how =
    behind.state === 'ready'
      ? `otea land sync ${id} brings it up to date`
      : behind.state === 'changes'
        ? 'that checkout has changes of its own, so it was left alone: bring it up to date yourself when you can (git merge --ff-only)'
        : behind.state === 'collides'
          ? `${behind.paths?.join(', ') ?? 'a file'} would replace ${behind.paths?.length === 1 ? 'a file' : 'files'} you keep out of git in that checkout, so it was left alone: move ${behind.paths?.length === 1 ? 'it' : 'them'} aside first`
          : `that checkout is on ${behind.on ?? 'another branch'}, so it was left alone: switch to ${behind.base} when you can`;
  return `${id} landed in its branch (nothing is pushed: this repository has no remote), but ${where} is ${commits} behind it: ${how}.`;
}
