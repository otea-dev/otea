import { execFileSync } from 'node:child_process';
import type { BranchStamp, FilesChanged } from './context.ts';

// What git says of the files a branch changes, with local reads only: a warning about two items
// that touch the same files must be cheap, so it never fetches. A branch counts as pushed when
// the remote-tracking ref of it exists (as the last fetch left it); a repo with no remote at all
// has nothing to push to, so its local branch is the one. These refs are the agent's to move, so
// they only ever feed a warning, never what a review is told to trust (see mergeRoundAt).

const GIT_MS = 10_000;
const NET_MS = 20_000;

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

// The refs of the repo and its remotes, read once.
type Snapshot = { refs: Map<string, string>; remotes: string[] };

function snapshotOf(cwd: string): Snapshot {
  const refs = new Map<string, string>();
  const listed = run(
    cwd,
    'for-each-ref',
    '--format=%(objectname) %(refname)',
    'refs/heads',
    'refs/remotes',
  );
  for (const line of (listed ?? '').split(/\r?\n/)) {
    const at = line.indexOf(' ');
    if (at > 0) refs.set(line.slice(at + 1), line.slice(0, at));
  }
  const remotes = (run(cwd, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  return { refs, remotes };
}

// The ref that holds the branch as pushed: its remote-tracking one (origin first), else the local
// branch in a repo with no remote. `local`: the local branch counts whatever the remote has (a base).
function pushedRef(
  snap: Snapshot,
  name: string,
  local: boolean,
): { ref: string; sha: string } | undefined {
  for (const remote of new Set(['origin', ...snap.remotes])) {
    const ref = `refs/remotes/${remote}/${name}`;
    const sha = snap.refs.get(ref);
    if (sha) return { ref, sha };
  }
  const own = `refs/heads/${name}`;
  const sha = snap.refs.get(own);
  return sha && (local || snap.remotes.length === 0) ? { ref: own, sha } : undefined;
}

export function stampAt(root: string): BranchStamp {
  return (branches, base) => {
    const snap = snapshotOf(root);
    const at = (name: string, local: boolean) =>
      `${name}=${pushedRef(snap, name, local)?.sha ?? '-'}`;
    const names = [...new Set(branches)].sort();
    return [at(base, true), ...names.map((name) => at(name, false))].join(' ');
  };
}

export function filesChangedAt(root: string): FilesChanged {
  return (branch, base) => {
    const snap = snapshotOf(root);
    const head = pushedRef(snap, branch, false);
    const onto = pushedRef(snap, base, true);
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
      `${onto.sha}...${head.sha}`,
    );
    return out === undefined ? undefined : [...new Set(out.split('\0').filter(Boolean))].sort();
  };
}

// What a round changed by hand when all it did was merge the base into work the person approved.
// `since` is the commit approved, `tip` the commit handed off, `joined` the commit of the base the
// tip holds, and `files` every file whose content is not what git's merge of `joined` into `since`
// gives (conflicts as resolved, and anything else the merge carries, conflicted or not).
export type MergeRound = { since: string; tip: string; joined: string; files: string[] };

// The most the review is shown of it; a larger one is reviewed whole instead of cut.
export const DIFF_CAP = 100_000;

const has = (cwd: string, ref: string): boolean =>
  (run(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) ?? '').trim() !== '';

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

const PLAIN = ['-c', 'core.quotePath=false', '-c', 'diff.mnemonicPrefix=false'];

// The tree git makes merging `joined` into `since`, conflicts left in as markers.
function autoMerge(root: string, joined: string, since: string): string | undefined {
  const tree = runKeeping(root, 'merge-tree', '--write-tree', '--no-messages', joined, since)
    ?.split(/\r?\n/)[0]
    ?.trim();
  return tree || undefined;
}

// The base as the remote really has it right now, never as a ref of this checkout says (an agent
// moves those): `git ls-remote` asks the remote itself, and the commit is fetched when this
// checkout lacks it. Undefined with no remote, no such branch there, or no way to reach it.
function remoteBaseTip(root: string, base: string): string | undefined {
  const remotes = (run(root, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  const named = (run(root, 'config', '--get', `branch.${base}.remote`) ?? '').trim();
  const fallback = remotes.includes('origin') ? 'origin' : remotes[0];
  const remote = remotes.includes(named) ? named : fallback;
  if (remote === undefined) return undefined;
  let listed: string;
  try {
    listed = execFileSync('git', ['ls-remote', '--heads', remote, `refs/heads/${base}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: NET_MS,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
  } catch {
    return undefined;
  }
  const sha = listed.split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return undefined;
  if (!has(root, sha)) {
    try {
      execFileSync('git', ['fetch', '--quiet', '--no-tags', remote, `refs/heads/${base}`], {
        cwd: root,
        stdio: 'ignore',
        timeout: NET_MS,
        env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      });
    } catch {
      return undefined;
    }
  }
  return has(root, sha) ? sha : undefined;
}

// Whether the round from `since` (the commit approved) to `tip` (the commit handed off now) only
// merges `base` into the approved work, and every file the merge changed by hand. It is, when the
// approved commit is in the history of the tip and the tip brings no commit of its own over what
// the base holds (merge commits aside). The base is the remote's own tip, asked now; a base read
// from a ref of this checkout would let an agent make its own commits look like the base's.
// Undefined (the whole change is reviewed) whenever that cannot be told, the round has work of
// its own, or what the merge changed is not something a person reads whole: more than DIFF_CAP of
// text, a binary file, a submodule.
export function mergeRoundAt(
  root: string,
  since: string,
  tip: string,
  base: string,
): MergeRound | undefined {
  const onto = remoteBaseTip(root, base);
  if (onto === undefined || since === tip || !has(root, since) || !has(root, tip)) return undefined;
  if (run(root, 'merge-base', '--is-ancestor', since, tip) === undefined) return undefined;
  const own = run(root, 'rev-list', '--no-merges', `${since}..${tip}`, `^${onto}`);
  if (own === undefined || own.trim() !== '') return undefined;
  const joined = (run(root, 'merge-base', tip, onto) ?? '').trim();
  if (joined === '') return undefined;
  const merged = autoMerge(root, joined, since);
  const handed = (run(root, 'rev-parse', '--verify', '--quiet', `${tip}^{tree}`) ?? '').trim();
  if (!merged || handed === '') return undefined;
  const plain = (...flags: string[]) =>
    run(root, ...PLAIN, 'diff', '--no-renames', '--no-ext-diff', ...flags, merged, handed);
  const counts = plain('-z', '--numstat');
  const modes = plain('-z', '--raw');
  if (counts === undefined || modes === undefined) return undefined;
  // `added<TAB>deleted<TAB>path`, a binary file's counts being `-`.
  const entries = counts
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.split('\t'));
  if (entries.some(([added, deleted]) => added === '-' || deleted === '-')) return undefined;
  // `:oldmode newmode oldsha newsha status`, then the path; mode 160000 is a submodule.
  const submodule = modes.split('\0').some((entry) => {
    const [old, now] = entry.split(' ');
    return entry.startsWith(':') && (old === ':160000' || now === '160000');
  });
  if (submodule) return undefined;
  const files = [...new Set(entries.map((entry) => entry.slice(2).join('\t')))].sort();
  const text = plain();
  if (text === undefined || text.length > DIFF_CAP) return undefined;
  return { since, tip, joined, files };
}

const diffs = new Map<string, string | undefined>();

// The diff a merge round changed by hand, worked out again from its commits (never from a ref):
// what is in the tip beyond the approved work and the base. Undefined when this checkout lacks a
// commit, so nothing is shown on a guess.
export function mergeDiff(root: string, round: MergeRound): string | undefined {
  const key = `${root}\0${round.since}\0${round.joined}\0${round.tip}`;
  if (diffs.has(key)) return diffs.get(key);
  let text: string | undefined;
  if (has(root, round.since) && has(root, round.tip) && has(root, round.joined)) {
    const merged = autoMerge(root, round.joined, round.since);
    const tree = run(root, 'rev-parse', '--verify', '--quiet', `${round.tip}^{tree}`);
    const handed = (tree ?? '').trim();
    text =
      merged && handed
        ? run(root, ...PLAIN, 'diff', '--no-renames', '--no-ext-diff', merged, handed)
        : undefined;
  }
  diffs.set(key, text);
  return text;
}
