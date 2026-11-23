import { readFile } from 'node:fs/promises';
import { evidenceFile } from '../app/evidence.ts';
import { getItem } from '../app/items.ts';
import { liveBoardOf } from '../app/next.ts';
import type { Project } from '../app/project.ts';
import { approvedTipOf } from '../app/tips.ts';
import { isClosed, positionOf } from '../core/board/engine.ts';
import { guardedBranch } from '../core/board/model.ts';
import { selectEvents, selectEvidence } from '../store/queries.ts';
import { git } from './diff-tip.ts';

// The attached diff of an item in review against the files the work handed off changes (P1-F2,
// P1-S2): a diff invented, or made of other work, and an empty commit, passed every check, and the
// person approved a review whose diff had nothing to do with what lands. `diff` is what the diff
// names, `landed` what the commits handed off change over where the base stood before them.
export type DiffFilesOff = { diff: string[]; landed: string[] };

const unquote = (path: string) => path.replace(/\\(["\\])/g, '$1');

// Every path the text of a diff names (both sides of a rename, a deleted or an added file), sorted:
// by its `diff --git` lines, else by the +++ and --- lines of a plain unified diff. Empty for a
// text that names none.
export function diffFiles(text: string): string[] {
  const paths = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const head = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
    if (head?.[1] && head[2]) {
      paths.add(unquote(head[1]));
      paths.add(unquote(head[2]));
    }
  }
  if (paths.size === 0) {
    for (const line of text.split(/\r?\n/)) {
      const side = /^(?:---|\+\+\+) (?:[ab]\/)?([^\t]+?)\s*(?:\t.*)?$/.exec(line)?.[1];
      if (side && side !== '/dev/null') paths.add(unquote(side));
    }
  }
  return [...paths].sort();
}

async function tryGit(cwd: string, ...args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, ...args);
  } catch {
    return undefined;
  }
}

// How many commits `tip` holds over `from`; undefined when git cannot tell.
async function commitsOver(cwd: string, from: string, tip: string): Promise<number | undefined> {
  const count = await tryGit(cwd, 'rev-list', '--count', `${from}..${tip}`);
  return count === undefined || count === '' ? undefined : Number(count);
}

// The files the work handed off changes: a branch over the base as it stood nearest to it
// (the remote's or the local one), the base itself over where it stood when the item was first
// claimed. Undefined when it cannot be told.
async function landedFiles(
  project: Project,
  id: string,
  tip: string,
  branch: string,
  base: string,
): Promise<string[] | undefined> {
  const cwd = project.root;
  let from: string | undefined;
  let diffArgs: string[];
  if (branch === base) {
    const first = selectEvents(project.db, id).find(({ type }) => type === 'claimed')?.data
      .baseTips;
    const tips = Array.isArray(first) ? first.filter((tipId) => typeof tipId === 'string') : [];
    let nearest: number | undefined;
    for (const candidate of tips) {
      const held = (await tryGit(cwd, 'merge-base', '--is-ancestor', candidate, tip)) !== undefined;
      const count = held ? await commitsOver(cwd, candidate, tip) : undefined;
      if (count !== undefined && (nearest === undefined || count < nearest)) {
        nearest = count;
        from = candidate;
      }
    }
    diffArgs = ['diff', '--no-renames', '-z', '--name-only', `${from}`, tip];
  } else {
    let nearest: number | undefined;
    for (const candidate of [`origin/${base}`, base]) {
      if (
        (await tryGit(cwd, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`)) ===
        undefined
      )
        continue;
      const count = await commitsOver(cwd, candidate, tip);
      if (count !== undefined && (nearest === undefined || count < nearest)) {
        nearest = count;
        from = candidate;
      }
    }
    diffArgs = ['diff', '--no-renames', '-z', '--name-only', `${from}...${tip}`];
  }
  if (from === undefined) return undefined;
  const out = await tryGit(cwd, '-c', 'core.quotePath=false', ...diffArgs);
  return out === undefined ? undefined : [...new Set(out.split('\0').filter(Boolean))].sort();
}

// The latest diff attached to an item in review, when the files it names are not the files the
// work handed off changes; null while it is not in review, no tip was recorded, no diff is
// attached, or git cannot tell.
export async function diffFilesOff(project: Project, id: string): Promise<DiffFilesOff | null> {
  const item = getItem(project, id);
  const board = liveBoardOf(project, item.collection);
  const guard = board ? guardedBranch(board.def) : undefined;
  const position = positionOf(item.state);
  const base = guard?.guard.base;
  if (!guard || base === undefined || isClosed(position) || position.phase === 'doing') return null;
  const branch = String(item.fields[guard.id] ?? '').trim();
  if (branch === '') return null;
  const tip = approvedTipOf(project, item.id, branch);
  if (!tip || tip.unchanged) return null;
  const attached = selectEvidence(project.db, item.id)
    .filter(({ kind }) => kind === 'diff')
    .at(-1);
  if (!attached) return null;
  let text: string;
  try {
    text = await readFile(evidenceFile(project.dataDir, attached.sha256), 'utf8');
  } catch {
    return null;
  }
  const landed = await landedFiles(project, item.id, tip.commit, branch, base);
  if (landed === undefined) return null;
  const diff = diffFiles(text);
  const same = diff.length === landed.length && diff.every((path, at) => path === landed[at]);
  return same ? null : { diff, landed };
}
