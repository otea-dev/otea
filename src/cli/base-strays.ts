import { checkGate, sameRepo } from '../app/gates.ts';
import { liveBoardOf } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { checkoutsOf, repoNameAt } from '../app/repos.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { branchesBrought, hasCommit, remoteOf } from './gitrepo.ts';

type ItemFacts = {
  id: string;
  collection: string;
  state: string;
  fields: Readonly<Record<string, unknown>>;
};

// The commits the local base holds that no approved item holds or records, as the push gate names
// them (`commits`), the remote-tracking ref they are measured against (`remote`, as last fetched:
// nothing here fetches) and what show says of them (`text`).
export type BaseStray = {
  base: string;
  remote: string;
  commits: { commit: string; subject: string }[];
  text: string;
};

const SHOWN = 5;

// The checkout of the item's repo to ask: cwd when it is that repo (or the item names none), else
// the first checkout the project knows of it; undefined when there is none, and nothing is said.
function checkoutOf(project: Project, cwd: string, repo: string): string | undefined {
  if (repo === '') return cwd;
  try {
    if (sameRepo(repoNameAt(project, cwd), repo)) return cwd;
  } catch {
    // cwd is no checkout the project knows: the repo's own checkouts are asked instead.
  }
  return checkoutsOf(project, repo)[0];
}

// Commits on the local base a board protects that the remote lacks and no approved or Done item
// holds or records: the commits the pre-push gate would refuse as `stray`. A commit runs no hook,
// so an agent can make one straight on the base (field study F1) and, without Otea's pre-push hook,
// nothing says so before a push; every worktree cut from the base carries it meanwhile. The remote
// is the tracking ref as last fetched, never fetched here, so a show stays cheap; a repo with no such
// ref, a closed item, and a board kept on its base (its own commits wait there) say nothing.
export function baseStray(project: Project, cwd: string, item: ItemFacts): BaseStray | undefined {
  const board = liveBoardOf(project, item.collection);
  const part = board ? guardedBranch(board.def) : undefined;
  const base = part?.guard.base;
  if (!board || !part || !base || isClosed(positionOf(item.state))) return undefined;
  if (String(item.fields[part.id] ?? '').trim() === base) return undefined;
  try {
    const repoPart = part.guard.repo;
    const repo = repoPart ? String(item.fields[repoPart] ?? '').trim() : '';
    const at = checkoutOf(project, cwd, repo);
    if (at === undefined) return undefined;
    const remote = remoteOf(at, base);
    if (!hasCommit(at, remote)) return undefined;
    const fields = { branch: base, ...(repo === '' ? {} : { repo }) };
    const { stray = [] } = checkGate(project, 'push', fields, () =>
      branchesBrought(at, base, remote, { lean: true }),
    );
    if (stray.length === 0) return undefined;
    const listed = stray
      .slice(0, SHOWN)
      .map(({ commit, subject }) => `${commit.slice(0, 7)} (${subject})`)
      .join(', ');
    const more = stray.length > SHOWN ? `, and ${stray.length - SHOWN} more` : '';
    const count = stray.length === 1 ? '1 commit' : `${stray.length} commits`;
    const text = `Warning: your local ${base} holds ${count} that ${remote} (as last fetched) lacks and no approved item holds or records, so nobody reviewed ${stray.length === 1 ? 'it' : 'them'}: ${listed}${more}. Do not push ${base} or cut a branch from it for ${item.id}; ask the person: otea ask ${item.id} "<question>".`;
    return {
      base,
      remote,
      commits: stray.map(({ commit, subject }) => ({ commit, subject })),
      text,
    };
  } catch {
    return undefined;
  }
}
