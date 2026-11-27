import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { BroughtCommit, Landing, MergeTake, Tip } from '../app/gates.ts';
import { excludeFromGit, gitDirsByWalking } from '../app/project.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// A commit object git writes only to chain merges in memory of the repo (never a ref): it needs an
// identity, which a fresh clone or a CI runner may not have.
const SCRATCH_IDENTITY = {
  GIT_AUTHOR_NAME: 'otea',
  GIT_AUTHOR_EMAIL: 'otea@localhost',
  GIT_COMMITTER_NAME: 'otea',
  GIT_COMMITTER_EMAIL: 'otea@localhost',
};

// The branch the HEAD file of the checkout at cwd names (also before the first commit), read
// without asking git: undefined when it cannot be told that way (a detached HEAD, git's own
// variables set, a repo that keeps its refs in a reftable), and git is asked.
function branchByReading(cwd: string): string | undefined {
  const dirs = gitDirsByWalking(cwd, process.env);
  if (!dirs || existsSync(join(dirs.common, 'reftable'))) return undefined;
  try {
    const head = /^ref: refs\/heads\/(\S.*?)\s*$/.exec(
      readFileSync(join(dirs.gitDir, 'HEAD'), 'utf8'),
    );
    return head?.[1];
  } catch {
    return undefined;
  }
}

// The branch checked out in the repo at cwd, even before its first commit; throws outside a repo
// or on a detached HEAD.
export function currentBranch(cwd: string): string {
  const read = branchByReading(cwd);
  if (read !== undefined) return read;
  try {
    return git(cwd, 'symbolic-ref', '--short', 'HEAD');
  } catch {
    throw new Error('no branch checked out here; name it with --branch <name>');
  }
}

// The branch checked out in the repo at cwd; undefined outside a repo or on a detached HEAD (a
// rebase under way), where git names none.
export function checkedOutBranch(cwd: string): string | undefined {
  const read = branchByReading(cwd);
  if (read !== undefined) return read;
  try {
    return git(cwd, 'symbolic-ref', '--short', '--quiet', 'HEAD') || undefined;
  } catch {
    return undefined;
  }
}

// Whether some checkout of the repository at cwd, the main one or a linked worktree, has `branch`
// checked out: what an MCP server can tell of where an agent works, since it only knows the
// directory its session started in. A worktree git marks prunable, or whose folder is gone, is not
// a checkout anyone works in. Undefined when git cannot say.
export function branchCheckedOutAnywhere(cwd: string, branch: string): boolean | undefined {
  try {
    // -z: entries end in NUL and a worktree's block in an empty one, so a path is read as it is.
    const listed = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return listed.split('\0\0').some((block) => {
      const lines = block.split('\0');
      const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
      if (path === undefined || !existsSync(path)) return false;
      if (lines.some((line) => line === 'prunable' || line.startsWith('prunable '))) return false;
      return lines.includes(`branch refs/heads/${branch}`);
    });
  } catch {
    return undefined;
  }
}

// How many commits `branch` holds over the first of `bases` the repo at cwd has: the branch as it
// is here, or else on origin. Undefined when the repo has neither, or cwd is no repo.
export function commitsOver(
  cwd: string,
  branch: string,
  bases: readonly string[],
): { base: string; count: number } | undefined {
  const tip =
    commitOf(cwd, `refs/heads/${branch}`) ?? commitOf(cwd, `refs/remotes/origin/${branch}`);
  if (!tip) return undefined;
  for (const base of bases) {
    if (base === branch || base === `origin/${branch}`) continue;
    const from = commitOf(cwd, base);
    if (!from) continue;
    try {
      return { base, count: Number(git(cwd, 'rev-list', '--count', `${from}..${tip}`)) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// The local branches of the repo at cwd; throws outside a repo.
export function localBranches(cwd: string): string[] {
  const listed = git(cwd, 'for-each-ref', '--format=%(refname:short)', 'refs/heads');
  return listed.split('\n').filter(Boolean);
}

// The commit a ref names in the repo at cwd, or undefined when it names none (a ref the repo does
// not have, or the all-zero id git gives a branch that is created or deleted).
function commitOf(cwd: string, ref: string): string | undefined {
  if (ref === '' || /^0+$/.test(ref)) return undefined;
  try {
    return git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || undefined;
  } catch {
    return undefined;
  }
}

// Whether a push from `from` (what the remote has of the branch) to `to` rewrites it rather than
// adding to it: `from` is not in the history of `to` (a force push after a rebase or an amend), or
// this clone never had it. A branch the push creates or deletes rewrites nothing.
export function rewritesRemote(cwd: string, from: string, to: string): boolean {
  if (/^0+$/.test(from) || /^0+$/.test(to)) return false;
  const tip = commitOf(cwd, to);
  if (!tip) return false;
  const remote = commitOf(cwd, from);
  return remote === undefined || !isAncestor(cwd, remote, tip);
}

// Whether the repo at cwd has the commit a ref names (false outside a repo).
export function hasCommit(cwd: string, ref: string): boolean {
  return commitOf(cwd, ref) !== undefined;
}

// What a push of `to` onto `from` brings in: the branches whose tips are in `to` and not yet in
// `from` (every one in `to` when `from` names no commit, none when `to` names none: a delete),
// local ones and the remote's alike, a remote one by its name on the remote (origin/feat/x is
// feat/x), so a branch reviewed on the remote is known in a fresh clone too. `unpushed` names the
// local branches among them that hold commits their remote never got: what the review saw is what
// was pushed, so those commits were never reviewed. `outside` names the commits of the push no
// given branch holds (local or the remote's), merge commits aside: a merge joins commits, it brings
// none of its own. Throws outside a repo.
export type Brought = {
  branches: string[];
  unpushed: { branch: string; remote: string; push: string }[];
  outside?: (held: readonly string[], tips?: readonly string[]) => BroughtCommit[];
  landsAs?: (landing: readonly Landing[], onto?: string) => boolean;
};

// `lean`: only the branches and `outside`, for a caller that asks no push or merge question
// (unpushed and landsAs are left out: one git call per local branch, and per landing).
export function branchesBrought(
  cwd: string,
  to: string,
  from?: string,
  { lean = false }: { lean?: boolean } = {},
): Brought {
  const tip = commitOf(cwd, to);
  if (!tip) return { branches: [], unpushed: [] };
  const base = from === undefined ? undefined : commitOf(cwd, from);
  const args = ['for-each-ref', '--format=%(refname)', `--merged=${tip}`];
  if (base) args.push(`--no-merged=${base}`);
  const refs = git(cwd, ...args, 'refs/heads', 'refs/remotes')
    .split(/\r?\n/)
    .filter(Boolean);
  const remotes = git(cwd, 'remote').split(/\r?\n/).filter(Boolean);
  const local = refs.flatMap((ref) =>
    ref.startsWith('refs/heads/') ? [ref.slice('refs/heads/'.length)] : [],
  );
  const fromRemotes = refs.flatMap((ref) => {
    if (!ref.startsWith('refs/remotes/')) return [];
    const short = ref.slice('refs/remotes/'.length);
    const remote = remotes.find((name) => short.startsWith(`${name}/`));
    const branch = remote === undefined ? undefined : short.slice(remote.length + 1);
    return branch === undefined || branch === 'HEAD' ? [] : [branch];
  });
  const unpushed = lean
    ? []
    : local.flatMap((branch) => {
        const remote = remoteName(cwd, branch);
        if (remote === undefined) return [];
        return isAncestor(cwd, `refs/heads/${branch}`, remote)
          ? []
          : [{ branch, remote, push: pushRemote(cwd, branch) }];
      });
  const brought: Brought = { branches: [...new Set([...local, ...fromRemotes])], unpushed };
  // With nothing on the remote to start from, the whole history would count as brought in: only a
  // push onto a branch the remote has is asked which commits ride along.
  if (base)
    brought.outside = (held, tips = []) =>
      commitsOutside(cwd, tip, base, held, refs, remotes, tips);
  if (!lean)
    brought.landsAs = (landing, onto) => {
      const start =
        onto === undefined ? base : (commitOf(cwd, remoteOf(cwd, onto)) ?? commitOf(cwd, onto));
      return landsAs(cwd, tip, start, landing);
    };
  return brought;
}

// Whether `tip` holds exactly what was approved of the branches it lands, merged onto `start` (the
// base as the remote has it): each branch at the commit the person approved (`tip`), or, when none
// was recorded, as it stands here. The approved commit itself always passes; so does any other
// commit with the same tree as that merge (a rebase, or a merge commit with nothing of its own). A
// merge with conflicts is never what was approved: its resolution was never reviewed.
function landsAs(
  cwd: string,
  tip: string,
  start: string | undefined,
  landing: readonly Landing[],
): boolean {
  const [only] = landing;
  if (landing.length === 1 && only?.tip?.commit === tip) return true;
  const commits: string[] = [];
  for (const { branch, tip: approved } of landing) {
    const commit = approved
      ? commitOf(cwd, approved.commit)
      : (commitOf(cwd, `refs/heads/${branch}`) ?? commitOf(cwd, remoteOf(cwd, branch)));
    // An approved commit this checkout never got can only be matched by its tree.
    if (!commit)
      return landing.length === 1 && approved !== undefined && treeOf(cwd, tip) === approved.tree;
    commits.push(commit);
  }
  let at = start;
  let tree = start === undefined ? undefined : treeOf(cwd, start);
  for (const commit of commits) {
    if (at === undefined) {
      at = commit;
      tree = treeOf(cwd, commit);
      continue;
    }
    try {
      tree = git(cwd, 'merge-tree', '--write-tree', at, commit).split(/\r?\n/)[0];
    } catch {
      return false;
    }
    if (commit === commits.at(-1)) break;
    at = execFileSync('git', ['commit-tree', String(tree), '-p', at, '-p', commit, '-m', 'otea'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ...SCRATCH_IDENTITY },
    }).trim();
  }
  return tree !== undefined && tree === treeOf(cwd, tip);
}

// Runs git, giving back its output, or when it failed the first error line it wrote to stderr.
function tried(cwd: string, ...args: string[]): { out: string } | { error: string } {
  try {
    return {
      out: execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    const lines = String((error as { stderr?: unknown }).stderr ?? '')
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter(Boolean);
    const line = lines.find((text) => /^(fatal|error): /.test(text)) ?? lines[0] ?? '';
    return { error: line.replace(/^(fatal|error): /, '') || `git ${args[0]} failed` };
  }
}

// Where to run git when it must read a remote: the repository's main checkout. A remote given by a
// relative path (`../origin.git`) is read from the folder git runs in, so from a linked worktree
// (.otea/worktrees/<item>) it names a folder that is no repository (field study 4, U6). The refs
// git fetches are shared by every checkout, so it makes no difference which one asks.
export function remoteCwd(cwd: string): string {
  try {
    const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    return basename(common) === '.git' ? dirname(common) : cwd;
  } catch {
    return cwd;
  }
}

// What a merge of the approved branch takes, as its remote has it right now (P3C-R3-1): a forge
// merges the branch there, which a clone without Otea's hook may have pushed to since the person
// approved it. The branch and the base it merges into are fetched from the remote the branch is
// pushed to; a repo with no such remote, or a remote with no branch of that name, merges the branch
// as this checkout has it. `given` is a commit the merge names (--commits), checked as well. Held
// when each is the approved commit, or a rebase of it onto the base with the same result; never
// throws: what git cannot tell is `unknown`, for the gate to refuse.
export function mergeTake(cwd: string, tip: Tip, base?: string, given?: string): MergeTake {
  try {
    const { branch } = tip;
    const remote = pushRemote(cwd, branch);
    const remotes = git(cwd, 'remote').split(/\r?\n/).filter(Boolean);
    const takes: { ref: string; at: string }[] = [];
    let start: string | undefined;
    if (remotes.includes(remote)) {
      const heads = [branch, ...(base ? [base] : [])].map((name) => `refs/heads/${name}`);
      const listed = tried(remoteCwd(cwd), 'ls-remote', '--heads', remote, ...heads);
      if ('error' in listed) return { unknown: `git could not reach ${remote} (${listed.error})` };
      const there = new Map(
        listed.out
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [commit = '', ref = ''] = line.split('\t');
            return [ref.slice('refs/heads/'.length), commit] as const;
          }),
      );
      const fetch = [...there.keys()]
        .filter((name) => commitOf(cwd, there.get(name) ?? '') === undefined)
        .map((name) => `+refs/heads/${name}:refs/remotes/${remote}/${name}`);
      if (fetch.length > 0) {
        const fetched = tried(remoteCwd(cwd), 'fetch', '--quiet', '--no-tags', remote, ...fetch);
        if ('error' in fetched)
          return { unknown: `git could not fetch it from ${remote} (${fetched.error})` };
      }
      const at = there.get(branch);
      const here = commitOf(cwd, `refs/heads/${branch}`);
      if (at) takes.push({ ref: `${remote}/${branch}`, at });
      else if (here) takes.push({ ref: branch, at: here });
      else return { unknown: `${remote} has no branch ${branch}, and neither has this checkout` };
      const onto = base ? there.get(base) : undefined;
      start = onto ?? (base ? commitOf(cwd, remoteOf(cwd, base)) : undefined);
    } else {
      const ref = remoteName(cwd, branch) ?? branch;
      const at = commitOf(cwd, ref);
      if (!at) return { unknown: `this checkout has no branch ${branch}` };
      takes.push({ ref, at });
      start = base ? (commitOf(cwd, remoteOf(cwd, base)) ?? commitOf(cwd, base)) : undefined;
    }
    if (given !== undefined) {
      const at = commitOf(cwd, given);
      if (!at) return { unknown: `${given} is not in this repository; fetch first` };
      takes.push({ ref: given, at });
    }
    for (const { ref, at } of takes) {
      if (landsAs(cwd, at, start, [{ branch, tip }])) continue;
      return {
        held: false,
        ref,
        commit: at.slice(0, 7),
        added: commitsAddedSince(cwd, tip, at, start),
      };
    }
    return { held: true };
  } catch (error) {
    return { unknown: error instanceof Error ? error.message : String(error) };
  }
}

// The commits `at` holds that the approved tip and the base do not, a rebased copy of an approved
// one aside, each by short id with its author, oldest first; none when this checkout lacks the
// approved commit.
export function commitsAddedSince(
  cwd: string,
  tip: Tip,
  at: string,
  start: string | undefined,
): { commit: string; author: string }[] {
  const approved = commitOf(cwd, tip.commit);
  if (!approved) return [];
  const listed = tried(
    cwd,
    'log',
    '--no-merges',
    '--cherry-pick',
    '--right-only',
    '--reverse',
    '--format=%h%x09%an',
    '--abbrev=7',
    `${approved}...${at}`,
    ...(start ? [`^${start}`] : []),
  );
  if ('error' in listed) return [];
  return listed.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit = '', author = ''] = line.split('\t');
      return { commit, author };
    });
}

function treeOf(cwd: string, commit: string): string | undefined {
  try {
    return git(cwd, 'rev-parse', '--verify', '--quiet', `${commit}^{tree}`) || undefined;
  } catch {
    return undefined;
  }
}

// Whether all that `commit` changes is in `base` already: merging it in leaves the base's tree as
// it is, as once a forge squash-merged or rebased it there (P3C-R3-10). False when this checkout
// lacks either commit, or the merge conflicts.
export function landedIn(cwd: string, commit: string, base: string): boolean {
  const tip = commitOf(cwd, commit);
  const onto = commitOf(cwd, base);
  if (!tip || !onto) return false;
  try {
    const tree = git(cwd, 'merge-tree', '--write-tree', onto, tip).split(/\r?\n/)[0];
    return tree !== undefined && tree === treeOf(cwd, onto);
  } catch {
    return false;
  }
}

// What an agent hands a branch off at: its commit and tree, for the gate to hold the landing to
// what the person approved. The remote's branch when it has one (the review reads what was
// pushed), else the local one; `local` first for a branch never pushed before its approval (the
// base itself, on a board that works straight on it). Undefined when this checkout has neither.
export function tipOf(cwd: string, branch: string, local = false): Tip | undefined {
  const here = commitOf(cwd, `refs/heads/${branch}`);
  const remote = remoteName(cwd, branch);
  const there = remote === undefined ? undefined : commitOf(cwd, remote);
  const commit = local ? (here ?? there) : (there ?? here);
  const tree = commit === undefined ? undefined : treeOf(cwd, commit);
  return commit === undefined || tree === undefined ? undefined : { branch, commit, tree };
}

// The commits in `tip` and not in `base` that none of the `held` branches holds, nor any of the
// `tips` (commits that hold the history under them; one this checkout lacks holds nothing), oldest
// first, each by its full id with its subject, merge commits aside; `refs` are the refs the push
// brings in, a branch counting by its local ref and by the remote's alike.
function commitsOutside(
  cwd: string,
  tip: string,
  base: string,
  held: readonly string[],
  refs: readonly string[],
  remotes: readonly string[],
  tips: readonly string[] = [],
): BroughtCommit[] {
  const holding = refs.filter((ref) =>
    held.some(
      (name) =>
        ref === `refs/heads/${name}` ||
        remotes.some((remote) => ref === `refs/remotes/${remote}/${name}`),
    ),
  );
  const under = tips.flatMap((commit) => commitOf(cwd, commit) ?? []);
  const listed = git(
    cwd,
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x09%s',
    tip,
    `^${base}`,
    ...holding.map((ref) => `^${ref}`),
    ...under.map((commit) => `^${commit}`),
    '--',
  );
  return listed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit = '', ...subject] = line.split('\t');
      return { commit, subject: subject.join('\t') };
    });
}

// The remote branch a local one is pushed to, by name (origin/feat/x): the remote-tracking branch
// of the same name, on the remote its upstream names or else on origin; only when the remote has
// none of that name, its upstream. git switch -c feat/x origin/main gives feat/x the upstream
// origin/main, yet what the review saw is what was pushed to origin/feat/x (P1-R2-1). Undefined
// when the remote has neither.
function remoteName(cwd: string, branch: string): string | undefined {
  const same = sameNameRemote(cwd, branch);
  if (same) return same;
  try {
    return git(cwd, 'rev-parse', '--abbrev-ref', `${branch}@{upstream}`) || undefined;
  } catch {
    return undefined;
  }
}

// The remote the branch is pushed to: the one its upstream names, else origin.
function pushRemote(cwd: string, branch: string): string {
  const named = configured(cwd, `branch.${branch}.remote`);
  return named === undefined || named === '.' ? 'origin' : named;
}

// The remote-tracking branch of the same name, on the remote its upstream names or else on origin.
function sameNameRemote(cwd: string, branch: string): string | undefined {
  for (const remote of new Set([pushRemote(cwd, branch), 'origin'])) {
    if (commitOf(cwd, `refs/remotes/${remote}/${branch}`)) return `${remote}/${branch}`;
  }
  return undefined;
}

// How a branch stands with its remote in the repo at cwd, for a handoff to check before the branch
// freezes in review: `ahead` when the remote branch of its name lacks commits of the local one,
// `unpushed` when the remote has no branch of its name though the repo has a remote, `missing`
// when the checkout has the branch neither here nor on the remote (`on` names the branch checked
// out). Undefined outside a repo.
export type PushState =
  | { kind: 'pushed' | 'local' }
  | { kind: 'ahead'; remote: string; push: string }
  | { kind: 'unpushed'; push: string }
  | { kind: 'missing'; on?: string };

export function pushState(cwd: string, branch: string): PushState | undefined {
  try {
    git(cwd, 'rev-parse', '--git-dir');
  } catch {
    return undefined;
  }
  const here = commitOf(cwd, `refs/heads/${branch}`);
  const remote = sameNameRemote(cwd, branch);
  const push = pushRemote(cwd, branch);
  if (!here) {
    if (remote) return { kind: 'pushed' };
    const on = checkedOutBranch(cwd);
    return on === undefined ? { kind: 'missing' } : { kind: 'missing', on };
  }
  if (remote) {
    return isAncestor(cwd, here, remote) ? { kind: 'pushed' } : { kind: 'ahead', remote, push };
  }
  const remotes = git(cwd, 'remote').split(/\r?\n/).filter(Boolean);
  return remotes.length === 0 ? { kind: 'local' } : { kind: 'unpushed', push };
}

// A git config value, or undefined when it is not set.
function configured(cwd: string, key: string): string | undefined {
  try {
    return git(cwd, 'config', '--get', key) || undefined;
  } catch {
    return undefined;
  }
}

function isAncestor(cwd: string, ancestor: string, of: string): boolean {
  try {
    git(cwd, 'merge-base', '--is-ancestor', ancestor, of);
    return true;
  } catch {
    return false;
  }
}

// An item landed on the remote's base while the main checkout's own base stayed where it was (an
// agent pushed `HEAD:main` from a worktree): `behind` commits the remote has that the local base
// lacks. `state`: whether git can bring the checkout up to date at once (`ready`: it is on the
// base with no change to a tracked file), or it is left alone: `changes`, checked out `elsewhere`
// (named in `on`), `diverged` (the local base has commits of its own the remote lacks, so no
// fast-forward can bring it up: that is the person's to untangle) or `collides` (a file arriving
// from the remote would replace one the person keeps out of git here, named in `paths`).
//
// With no remote at all (`local`): the item landed in a worktree branch, and nothing was pushed
// anywhere; `behind` counts the commits of the landed tip the local base lacks, `remote` is empty
// and `target` is the commit to fast-forward to (the landed tip itself).
export type LocalBehind = {
  base: string;
  remote: string;
  // What a fast-forward merges: the remote's base (the default), or with no remote the landed commit.
  target?: string;
  local?: true;
  behind: number;
  checkout: string;
  state: 'ready' | 'changes' | 'elsewhere' | 'diverged' | 'collides';
  on?: string;
  paths?: string[];
};

// How many ignored paths are named when a fast-forward would replace them.
const COLLISION_NAMED = 3;

// The files that arrive with the remote's base (added there, not in the local base) where the
// checkout holds an ignored file or folder of its own: a fast-forward writes over those without a
// word (an .env, a local config). Empty when none does.
function collidingPaths(checkout: string, from: string, to: string): string[] {
  const split = (text: string) => text.split('\0').filter(Boolean);
  const incoming = split(git(checkout, 'diff', '--name-only', '-z', '--diff-filter=A', from, to));
  if (incoming.length === 0) return [];
  const ignored = split(
    git(
      checkout,
      '--no-optional-locks',
      'ls-files',
      '-z',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
    ),
  );
  return incoming.filter((path) =>
    ignored.some((mine) => (mine.endsWith('/') ? path.startsWith(mine) : path === mine)),
  );
}

// Brings the checkout's local base up to the remote's by a fast-forward and nothing else, and only
// while the checkout is on that base with no change to a tracked file and no ignored file of its
// own in the way (asked again here: it may have changed since it was read). Whether it moved.
export function fastForward(behind: LocalBehind): boolean {
  const { checkout, base, remote } = behind;
  const target = behind.target ?? `refs/remotes/${remote}`;
  if (checkedOutBranch(checkout) !== base) return false;
  if (git(checkout, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=no') !== '')
    return false;
  try {
    if (collidingPaths(checkout, `refs/heads/${base}`, target).length > 0) return false;
    git(checkout, 'merge', '--ff-only', '--quiet', target);
    return true;
  } catch {
    return false;
  }
}

// Whether `commit` (what landed) is in the remote's `base`, as this repo last saw it, and not in
// the local `base` of the checkout at `checkout`; with no remote at all, whether it is not in the
// local base yet (the item landed in a worktree's branch and nothing was pushed). Undefined
// otherwise.
export function localBehind(
  checkout: string,
  base: string,
  commit: string,
): LocalBehind | undefined {
  const remote = remoteName(checkout, base);
  const here = commitOf(checkout, `refs/heads/${base}`);
  if (!remote) {
    // A remote the base has no branch on is no case of this: only a repo with none at all.
    if (git(checkout, 'remote') !== '') return undefined;
    const tip = commitOf(checkout, commit);
    if (!tip || !here || tip === here || isAncestor(checkout, tip, here)) return undefined;
    return behindState(checkout, base, here, tip, tip, '', true);
  }
  const there = commitOf(checkout, `refs/remotes/${remote}`);
  if (!there || !here || here === there) return undefined;
  const holds = (ref: string) =>
    isAncestor(checkout, commit, ref) || landedIn(checkout, commit, ref);
  if (!holds(there) || holds(here)) return undefined;
  return behindState(checkout, base, here, there, `refs/remotes/${remote}`, remote, false);
}

// How far the local base is from `there` and what stands in the way of a fast-forward to `target`.
function behindState(
  checkout: string,
  base: string,
  here: string,
  there: string,
  target: string,
  remote: string,
  local: boolean,
): LocalBehind | undefined {
  const behind = Number(git(checkout, 'rev-list', '--count', `${here}..${there}`));
  if (!(behind > 0)) return undefined;
  const on = checkedOutBranch(checkout);
  // Asked without taking git's optional locks: it refreshes the index, which the person's own git
  // (or their editor's) may be using at that moment.
  const changed =
    git(checkout, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=no') !== '';
  // The local base has commits of its own the target lacks: nothing fast-forwards it.
  const diverged = !isAncestor(checkout, here, there);
  const colliding =
    diverged || on !== base || changed
      ? []
      : collidingPaths(checkout, `refs/heads/${base}`, target);
  const state = diverged
    ? 'diverged'
    : on !== base
      ? 'elsewhere'
      : changed
        ? 'changes'
        : colliding.length > 0
          ? 'collides'
          : 'ready';
  return {
    base,
    remote,
    ...(local ? { local: true as const, target } : {}),
    behind,
    checkout,
    state,
    ...(on !== undefined && on !== base ? { on } : {}),
    ...(state === 'collides' ? { paths: colliding.slice(0, COLLISION_NAMED) } : {}),
  };
}

// Where `branch` (here, or else on origin) is in `base` already: `merged` when the base as the
// remote has it holds it (as this checkout last saw it), or the local base does in a repo with no
// remote; `local` when only the local base holds it, with the remote base it is not in yet
// (`remote`, origin/main) and the remote to push it to (`push`), P6-R3-2. Undefined when neither
// holds it, the repo has either of them not, or cwd is no repo.
export type MergedWhere = { merged: true } | { merged: false; remote: string; push: string };

export function mergedInto(cwd: string, branch: string, base: string): MergedWhere | undefined {
  const tip =
    commitOf(cwd, `refs/heads/${branch}`) ?? commitOf(cwd, `refs/remotes/origin/${branch}`);
  if (!tip) return undefined;
  const remote = remoteOf(cwd, base);
  const holds = (ref: string) => commitOf(cwd, ref) !== undefined && isAncestor(cwd, tip, ref);
  if (holds(`refs/remotes/${remote}`)) return { merged: true };
  if (!holds(`refs/heads/${base}`)) return undefined;
  const remotes = git(cwd, 'remote').split(/\r?\n/).filter(Boolean);
  if (remotes.length === 0) return { merged: true };
  return { merged: false, remote, push: pushRemote(cwd, base) };
}

// What the remote has of a branch, as this checkout last saw it: the remote branch it is pushed
// to (remoteName), or else origin/<branch>.
export function remoteOf(cwd: string, branch: string): string {
  return remoteName(cwd, branch) ?? `origin/${branch}`;
}

// Whether cwd is in a repo's main checkout, not one of its linked worktrees (git worktree add);
// false outside a repo.
export function inMainCheckout(cwd: string): boolean {
  const dirs = gitDirsByWalking(cwd, process.env);
  if (dirs) return dirs.gitDir === dirs.common;
  try {
    const dir = resolve(cwd, git(cwd, 'rev-parse', '--git-dir'));
    const common = resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir'));
    return dir === common;
  } catch {
    return false;
  }
}

// The top folder of the checkout at cwd (a linked worktree's own, not the main checkout's), or
// undefined outside a repo.
export function checkoutRoot(cwd: string): string | undefined {
  try {
    return resolve(git(cwd, 'rev-parse', '--show-toplevel'));
  } catch {
    return undefined;
  }
}

// The top folder of the repo at cwd, or cwd itself outside a repo.
export function repoRoot(cwd: string): string {
  return checkoutRoot(cwd) ?? resolve(cwd);
}

// Where the repo at cwd keeps a path of its git dir, following its config (core.hooksPath for
// hooks/); throws outside a repo.
export function gitPath(cwd: string, path: string): string {
  return resolve(cwd, git(cwd, 'rev-parse', '--git-path', path));
}

// How a file Otea writes for this machine alone (it names this machine's path to Otea) stands with
// git: kept out through .git/info/exclude (never .gitignore, a tracked file), already tracked (Otea
// leaves git alone and says so), or outside any repo.
export type KeptOut = 'excluded' | 'tracked' | 'outside';

export function keepOutOfGit(file: string): KeptOut {
  let top: string;
  try {
    top = git(dirname(file), 'rev-parse', '--show-toplevel');
  } catch {
    return 'outside';
  }
  const path = relative(top, file).split(sep).join('/');
  try {
    git(top, 'ls-files', '--error-unmatch', '--', path);
    return 'tracked';
  } catch {}
  excludeFromGit(resolve(top, git(top, 'rev-parse', '--git-common-dir')), `/${path}`);
  return 'excluded';
}

// What a command says after the file it wrote, by how it stands with git.
export function keptOutNote(file: string, kept: KeptOut): string | undefined {
  if (kept === 'excluded') {
    return "kept out of git through .git/info/exclude: it names this machine's path to Otea";
  }
  if (kept === 'tracked') {
    return `${basename(file)} is tracked by git: it now names this machine's path to Otea, so keep that change out of your commits`;
  }
  return undefined;
}
