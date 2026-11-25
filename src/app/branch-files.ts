import { execFileSync } from 'node:child_process';
import type { FilesChanged } from './context.ts';

// What git says of the files a branch changes, with local reads only: a warning about two items
// that touch the same files must be cheap, so it never fetches. A branch counts as pushed when
// the remote-tracking ref of it exists (as the last fetch left it); a repo with no remote at all
// has nothing to push to, so its local branch is the one.

const GIT_MS = 10_000;

function run(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return undefined;
  }
}

const has = (cwd: string, ref: string): boolean =>
  (run(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) ?? '').trim() !== '';

// The ref that holds the branch as pushed: its remote-tracking one (origin first), else the local
// branch in a repo with no remote. `local`: the local branch counts whatever the remote has (a base).
function pushedRef(
  cwd: string,
  name: string,
  remotes: string[],
  local: boolean,
): string | undefined {
  for (const remote of new Set(['origin', ...remotes])) {
    const ref = `refs/remotes/${remote}/${name}`;
    if (has(cwd, ref)) return ref;
  }
  const own = `refs/heads/${name}`;
  return (local || remotes.length === 0) && has(cwd, own) ? own : undefined;
}

// What a round changed by hand when all it did was merge the base into work the person approved.
// `files` are the files whose content is not what the merge of the base into the approved commit
// gives (the conflicts as resolved, and anything else the merge commit carries), `diff` the change
// from that merge to the commit handed off, capped; empty `files` mean the merge changed nothing by
// hand. `since` and `tip` are the approved and the handed-off commits.
export type Resolution = { since: string; tip: string; files: string[]; diff: string };

const DIFF_CAP = 100_000;

// The same, run to read its output even when it exits 1 (a merge with conflicts still writes the
// tree).
function runKeeping(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (error) {
    const { status, stdout } = error as { status?: number | null; stdout?: unknown };
    return status === 1 && typeof stdout === 'string' ? stdout : undefined;
  }
}

// Whether the round from `since` (the commit approved) to `tip` (the commit handed off now) only
// merges `base` into the approved work, and what the merge changed by hand. It is, when the
// approved commit is in the history of the tip and the tip brings no commit of its own over what
// the base holds (merge commits aside): all it adds is the base and the merge. The resolution is
// then the tip's tree against the one git makes merging the base commit the tip holds into the
// approved commit (conflicts left in as markers), so what the person reads is what was decided by
// hand, never the base's own changes, which landed through their own review. Undefined whenever
// that cannot be told or the round has work of its own: the whole change is reviewed then.
export function resolutionAt(
  root: string,
  since: string,
  tip: string,
  base: string,
): Resolution | undefined {
  const remotes = (run(root, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  const onto = pushedRef(root, base, remotes, true);
  if (onto === undefined || since === tip || !has(root, since) || !has(root, tip)) return undefined;
  if (run(root, 'merge-base', '--is-ancestor', since, tip) === undefined) return undefined;
  const own = run(root, 'rev-list', '--no-merges', `${since}..${tip}`, `^${onto}`);
  if (own === undefined || own.trim() !== '') return undefined;
  const joined = (run(root, 'merge-base', tip, onto) ?? '').trim();
  if (joined === '') return undefined;
  const merged = runKeeping(root, 'merge-tree', '--write-tree', '--no-messages', joined, since)
    ?.split(/\r?\n/)[0]
    ?.trim();
  const handed = (run(root, 'rev-parse', '--verify', '--quiet', `${tip}^{tree}`) ?? '').trim();
  if (!merged || handed === '') return undefined;
  const plain = ['-c', 'core.quotePath=false', '-c', 'diff.mnemonicPrefix=false'];
  const names = run(
    root,
    ...plain,
    'diff',
    '--no-renames',
    '--no-ext-diff',
    '-z',
    '--name-only',
    merged,
    handed,
  );
  const text = run(root, ...plain, 'diff', '--no-renames', '--no-ext-diff', merged, handed);
  if (names === undefined || text === undefined) return undefined;
  return {
    since,
    tip,
    files: [...new Set(names.split('\0').filter(Boolean))].sort(),
    diff: text.length > DIFF_CAP ? `${text.slice(0, DIFF_CAP)}\n... cut` : text,
  };
}

export function filesChangedAt(root: string): FilesChanged {
  return (branch, base) => {
    const remotes = (run(root, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
    const head = pushedRef(root, branch, remotes, false);
    const onto = pushedRef(root, base, remotes, true);
    if (head === undefined || onto === undefined) return undefined;
    // The names as git has them whatever the person's config says, NUL-separated.
    const out = run(
      root,
      '-c',
      'core.quotePath=false',
      '-c',
      'diff.mnemonicPrefix=false',
      'diff',
      '--no-renames',
      '--no-ext-diff',
      '-z',
      '--name-only',
      `${onto}...${head}`,
    );
    return out === undefined ? undefined : [...new Set(out.split('\0').filter(Boolean))].sort();
  };
}
