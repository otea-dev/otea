import { execFile } from 'node:child_process';
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

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

// A path as git quotes it in a diff (core.quotePath): C-style escapes, a non-ASCII letter as the
// octal bytes of its UTF-8. Only a quoted path has escapes; one git left bare is taken as it is.
function unquote(path: string): string {
  const bytes: number[] = [];
  for (let at = 0; at < path.length; at++) {
    const char = path.charAt(at);
    const octal = /^[0-7]{3}/.exec(path.slice(at + 1))?.[0];
    if (char !== '\\') bytes.push(...Buffer.from(char));
    else if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8));
      at += 3;
    } else {
      const next = path.charAt(at + 1);
      bytes.push(...(next in ESCAPES ? [ESCAPES[next] ?? 0] : Buffer.from(next)));
      at += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

// `"…"` is the quoted spelling of a path, `bare` the other.
const pathOf = (quoted: string | undefined, bare: string | undefined): string =>
  quoted === undefined ? (bare ?? '') : unquote(quoted);

// Every path the text of a diff names (both sides of a rename, a deleted or an added file), sorted:
// by its `diff --git` lines, else by the +++ and --- lines of a plain unified diff. Empty for a
// text that names none. A path is kept as written: no trimming.
export function diffFiles(text: string): string[] {
  const paths = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const head = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/.exec(line);
    if (head) {
      paths.add(pathOf(head[1], head[2]));
      paths.add(pathOf(head[3], head[4]));
    }
  }
  if (paths.size === 0) {
    for (const line of lines) {
      const side = /^(?:---|\+\+\+) (?:"[ab]\/(.+)"|(?:[ab]\/)?([^\t]+))(?:\t.*)?$/.exec(line);
      const path = side && pathOf(side[1], side[2]);
      if (path && path !== '/dev/null') paths.add(path);
    }
  }
  return [...paths].filter(Boolean).sort();
}

// Git's output for paths, as it is (with -z, NUL-separated): never trimmed, since a name may begin
// or end with a space, which `git` of diff-tip.ts, made for hashes and counts, would cut.
function gitPaths(cwd: string, ...args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : String(stdout)),
    );
  });
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
    diffArgs = ['diff', '--no-renames', '--no-ext-diff', '-z', '--name-only', `${from}`, tip];
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
    diffArgs = ['diff', '--no-renames', '--no-ext-diff', '-z', '--name-only', `${from}...${tip}`];
  }
  if (from === undefined) return undefined;
  // The names as git has them whatever the person's config says (no quoting, no mnemonic prefix,
  // no external diff tool), NUL-separated.
  const out = await gitPaths(
    cwd,
    '-c',
    'core.quotePath=false',
    '-c',
    'diff.mnemonicPrefix=false',
    ...diffArgs,
  );
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
  // Work that changes no file is never a match, whatever the diff names (an empty commit and an
  // invented diff both list nothing): there is nothing for the diff to be the diff of.
  const same =
    landed.length > 0 &&
    diff.length === landed.length &&
    diff.every((path, at) => path === landed[at]);
  return same ? null : { diff, landed };
}
