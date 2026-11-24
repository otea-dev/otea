import { checkGate } from '../app/gates.ts';
import { liveBoardOf } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { branchesBrought, remoteOf } from './gitrepo.ts';

type ItemFacts = {
  id: string;
  collection: string;
  state: string;
  fields: Readonly<Record<string, unknown>>;
};

const SHOWN = 5;

// Commits on the local base a board protects that the remote lacks and no approved or Done item
// records or holds: the commits the pre-push gate would refuse as `stray`. A commit runs no hook, so
// an agent can make one straight on the base (field study F1) and, without Otea's pre-push hook,
// nothing says so before a push; every worktree cut from the base carries it meanwhile.
export function baseStrayLine(project: Project, cwd: string, item: ItemFacts): string | undefined {
  const board = liveBoardOf(project, item.collection);
  const part = board ? guardedBranch(board.def) : undefined;
  const base = part?.guard.base;
  if (!board || !part || !base || isClosed(positionOf(item.state))) return undefined;
  const branch = String(item.fields[part.id] ?? '').trim();
  // A board kept on its base holds its own commits there until they land (drift says what moved).
  if (branch === base) return undefined;
  try {
    const repoPart = part.guard.repo;
    const repo = repoPart ? String(item.fields[repoPart] ?? '').trim() : '';
    const fields = { branch: base, ...(repo === '' ? {} : { repo }) };
    const result = checkGate(project, 'push', fields, () => ({
      ...branchesBrought(cwd, base, remoteOf(cwd, base)),
    }));
    const stray = result.stray ?? [];
    if (stray.length === 0) return undefined;
    const listed = stray
      .slice(0, SHOWN)
      .map(({ commit, subject }) => `${commit.slice(0, 7)} (${subject})`)
      .join(', ');
    const more = stray.length > SHOWN ? `, and ${stray.length - SHOWN} more` : '';
    const count = stray.length === 1 ? '1 commit' : `${stray.length} commits`;
    return `Warning: your local ${base} holds ${count} the remote lacks that no approved item holds or records, so nobody reviewed ${stray.length === 1 ? 'it' : 'them'}: ${listed}${more}. Do not push ${base} or cut a branch from it for ${item.id}; ask the person: otea ask ${item.id} "<question>".`;
  } catch {
    return undefined;
  }
}
