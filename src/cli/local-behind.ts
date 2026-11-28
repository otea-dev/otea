import { getItem } from '../app/items.ts';
import { liveBoardOf } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { approvedTipOf, type Tip } from '../app/tips.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { DONE, guardedBranch } from '../core/board/model.ts';
import { fastForward, isAncestor, type LocalBehind, landsExactly, localBehind } from './gitrepo.ts';

export type { LocalBehind };

// A repo with no remote has nowhere to push to, so what the person approved lands by bringing their
// base up to the commit the worker named: the item's branch, with the base merged into it when the
// base moved on. Done here with the checks of `otea land sync` (only a fast-forward, only a
// checkout that is on the base with no change to a tracked file and no file of its own in the way)
// and only for a commit that holds exactly what the person approved. The refusal, in plain words,
// is what the item waits on; undefined once the base holds the commit.
export function landOnBase(
  checkout: string,
  id: string,
  base: string,
  branch: string,
  commits: readonly string[],
  approved?: Tip,
): string | undefined {
  const refused = `${id} not handed off:`;
  const target = commits.find((commit) =>
    commits.every((each) => isAncestor(checkout, each, commit)),
  );
  if (target === undefined) {
    return `${refused} the commits it names are not one line of work: write the hash of the last commit of ${branch} (git rev-parse --short HEAD in your worktree).`;
  }
  if (!landsExactly(checkout, target, base, branch, approved)) {
    return `${refused} ${target.slice(0, 7)} would not make ${base} hold exactly what the person approved of ${branch}${approved ? ` (${approved.commit.slice(0, 7)})` : ''}: it brings in changes nobody reviewed, or a merge whose conflicts the review never saw, so ${base} was not moved. Land the approved commit as it is, or with ${base} merged into ${branch} and nothing else; for anything else take ${id} back to the step before this one so it is reviewed again.`;
  }
  const behind = localBehind(checkout, base, target);
  if (behind === undefined) return undefined;
  const to = target.slice(0, 7);
  const waits = (why: string): string =>
    `${refused} ${why} Do not merge, pull or switch branches there yourself: tell the person what blocks it (otea ask ${id} "<what blocks it>"), and once it is clear hand off again and ${base} moves up to ${to}. The item waits in this step.`;
  const where = `your folder (${behind.checkout})`;
  if (behind.state === 'changes') {
    return waits(
      `${where} has changes of its own to tracked files, so ${base} was left where it is (nothing is pushed: this repository has no remote).`,
    );
  }
  if (behind.state === 'elsewhere') {
    return waits(
      `${where} is on ${behind.on ?? 'another branch'}, not on ${base}, so ${base} was left where it is.`,
    );
  }
  if (behind.state === 'collides') {
    return waits(
      `${behind.paths?.join(', ') ?? 'a file'} would replace ${behind.paths?.length === 1 ? 'a file' : 'files'} you keep out of git in ${where}, so ${base} was left where it is.`,
    );
  }
  if (!fastForward(behind)) {
    return waits(`${where} changed while ${base} was being moved, so it was left where it is.`);
  }
  return undefined;
}

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
