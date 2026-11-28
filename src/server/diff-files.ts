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
// `lines` is set when both name the same files and the lines they change differ.
export type DiffFilesOff = { diff: string[]; landed: string[]; lines?: true };

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

// The changed lines of a diff, per file: `path`, a NUL, then `+` or `-` and the line, sorted. The
// context lines, the hunk headers and the index lines around them are left out, so the same
// changes written with another amount of context are the same lines. Hunks are followed by their
// counts; a line a hand-made diff leaves outside its counts still counts when it begins with + or -.
export function changedLines(text: string): string[] {
  const out: string[] = [];
  let path = '';
  let minus = '';
  let old = 0;
  let added = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const inHunk = old > 0 || added > 0;
    if (!inHunk || !/^[ +\\-]/.test(line)) {
      const head = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+?)"|b\/(.+?))$/.exec(line);
      const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      const side = /^(---|\+\+\+) (?:"[ab]\/(.+)"|(?:[ab]\/)?([^\t]+))(?:\t.*)?$/.exec(line);
      if (head) {
        path = pathOf(head[3], head[4]);
        old = 0;
        added = 0;
        continue;
      }
      if (hunk) {
        old = Number(hunk[1] ?? 1);
        added = Number(hunk[2] ?? 1);
        continue;
      }
      if (side && !inHunk) {
        const named = pathOf(side[2], side[3]);
        if (side[1] === '---') minus = named === '/dev/null' ? '' : named;
        else path = named === '/dev/null' ? minus : named;
        continue;
      }
    }
    if (line.startsWith('+')) {
      out.push(`${path}\0${line}`);
      added = Math.max(0, added - 1);
    } else if (line.startsWith('-')) {
      out.push(`${path}\0${line}`);
      old = Math.max(0, old - 1);
    } else if (line.startsWith(' ')) {
      old = Math.max(0, old - 1);
      added = Math.max(0, added - 1);
    }
  }
  return out.sort();
}

type Landed = { files: string[]; range: string[] };

// The files the work handed off changes: a branch over the base as it stood nearest to it
// (the remote's or the local one), the base itself over where it stood when the item was first
// claimed; `range` is what git compares to get them. Undefined when it cannot be told.
async function landedFiles(
  project: Project,
  id: string,
  tip: string,
  branch: string,
  base: string,
): Promise<Landed | undefined> {
  const cwd = project.root;
  let from: string | undefined;
  let range: string[];
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
    range = [`${from}`, tip];
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
    range = [`${from}...${tip}`];
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
    'diff',
    '--no-renames',
    '--no-ext-diff',
    '-z',
    '--name-only',
    ...range,
  );
  return out === undefined
    ? undefined
    : { files: [...new Set(out.split('\0').filter(Boolean))].sort(), range };
}

// The patch of the work handed off, as git has it whatever the person's config says.
function landedPatch(cwd: string, { range }: Landed, context: number): Promise<string | undefined> {
  return gitPaths(
    cwd,
    '-c',
    'core.quotePath=false',
    '-c',
    'diff.mnemonicPrefix=false',
    'diff',
    '--no-renames',
    '--no-ext-diff',
    '--no-color',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    `-U${context}`,
    ...range,
  );
}

// The lines the work handed off changes, as `changedLines` has them for an attached diff.
async function landedLines(cwd: string, found: Landed): Promise<string[] | undefined> {
  const out = await landedPatch(cwd, found, 0);
  return out === undefined ? undefined : changedLines(out);
}

// What the review reads as the diff of an item handed off on a branch (D-492953): git's own diff of
// the work handed off, over the base as it stood nearest to it, never a file the agent attached.
// Undefined while the item is in no review, has no branch or no tip recorded, the tip holds no
// change, or git cannot tell.
export async function branchDiffOf(
  project: Project,
  id: string,
): Promise<{ text: string; commit: string; branch: string; base: string } | undefined> {
  const item = getItem(project, id);
  const board = liveBoardOf(project, item.collection);
  const guard = board ? guardedBranch(board.def) : undefined;
  const position = positionOf(item.state);
  const base = guard?.guard.base;
  if (!guard || base === undefined || isClosed(position) || position.phase === 'doing')
    return undefined;
  const branch = String(item.fields[guard.id] ?? '').trim();
  if (branch === '') return undefined;
  const tip = approvedTipOf(project, item.id, branch);
  if (!tip || tip.unchanged) return undefined;
  const found = await landedFiles(project, item.id, tip.commit, branch, base);
  if (found === undefined) return undefined;
  const text = await landedPatch(project.root, found, 3);
  return text === undefined || text === '' ? undefined : { text, commit: tip.commit, branch, base };
}

// Otea's own diff file of an item: kept by Otea at the handoff (app/evidence.ts recordBranchDiff).
export const isOteaDiff = ({ actor }: { actor: { kind: string; name: string } }): boolean =>
  actor.kind === 'human' && actor.name === 'otea';

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
    .filter((each) => each.kind === 'diff' && !isOteaDiff(each))
    .at(-1);
  if (!attached) return null;
  let text: string;
  try {
    text = await readFile(evidenceFile(project.dataDir, attached.sha256), 'utf8');
  } catch {
    return null;
  }
  const found = await landedFiles(project, item.id, tip.commit, branch, base);
  if (found === undefined) return null;
  const landed = found.files;
  const diff = diffFiles(text);
  // Work that changes no file is never a match, whatever the diff names (an empty commit and an
  // invented diff both list nothing): there is nothing for the diff to be the diff of.
  const sameFiles =
    landed.length > 0 &&
    diff.length === landed.length &&
    diff.every((path, at) => path === landed[at]);
  if (!sameFiles) return { diff, landed };
  // The names match; the lines must too (D-492953): a diff that names the right file and shows
  // other lines is not the diff of the work.
  const lines = await landedLines(project.root, found);
  if (lines === undefined) return null;
  const shown = changedLines(text);
  const sameLines = shown.length === lines.length && shown.every((line, at) => line === lines[at]);
  return sameLines ? null : { diff, landed, lines: true };
}
