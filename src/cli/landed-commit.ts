import { execFileSync } from 'node:child_process';
import { landedIn } from './gitrepo.ts';

// What a board's «Commit pushed» (Commit en main) field claims: the commit it names holds the work
// the person approved, and reached the base the board protects. The field took any text, «banana»
// or the hash of a push the hook had refused, and the item went Done (P8-F1, P9-F5), so a handoff
// that records one checks it here.

// A hash is 7 to 40 hex digits (SHA-1) or up to 64 (SHA-256); only what git resolves as a commit
// of this checkout counts as one, so a word that happens to be hex is not taken for one.
const HASH = /\b[0-9a-f]{7,64}\b/gi;
const GIT_MS = 30_000;
// A fetch asks for no password and opens no prompt: it fails, saying so, in a session nobody sees.
// Its messages are read, so git speaks English whatever the person's language is.
const QUIET = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  LC_ALL: 'C',
  LANGUAGE: 'C',
};

type Ran = { out: string } | { error: string };

function run(cwd: string, ...args: string[]): Ran {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_MS,
      env: QUIET,
    }).trim();
    return { out };
  } catch (error) {
    const lines = String((error as { stderr?: unknown }).stderr ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const line = lines.find((text) => /^(fatal|error): /.test(text)) ?? lines[0] ?? '';
    return { error: line.replace(/^(fatal|error): /, '') || `git ${args[0]} failed` };
  }
}

const git = (cwd: string, ...args: string[]): string | undefined => {
  const ran = run(cwd, ...args);
  return 'out' in ran ? ran.out : undefined;
};

const commitOf = (cwd: string, ref: string): string | undefined =>
  git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || undefined;

// Whether `ancestor` is in the history of `ref`.
const holds = (cwd: string, ref: string, ancestor: string): boolean =>
  git(cwd, 'merge-base', '--is-ancestor', ancestor, ref) !== undefined;

// The remote a base is pushed to: the one its upstream names, else origin, else the only one.
function remoteOfBase(cwd: string, base: string): string | undefined {
  const remotes = (git(cwd, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  if (remotes.length === 0) return undefined;
  const named = git(cwd, 'config', '--get', `branch.${base}.remote`);
  if (named && remotes.includes(named)) return named;
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

// The work the person approved: what the item's handoff into review recorded (app/tips.ts).
export type ApprovedWork = { commit: string; unchanged?: true };

// The refusal of a handoff whose `name` field does not hold a commit of `base` as it stands now, or
// undefined when it does. Every commit it names must be in the base: with a remote, on the remote's
// branch of it as the remote has it now (a fetch, then git branch -r --contains), since a push a
// hook refused is not there; with none, in the local base. At least one must hold the work the
// person approved (the approved commit in its history, or all it changes in the commit, as a rebase
// or a squash leaves it), so an older commit of the base, such as git rev-parse origin/main before
// any push, is no proof. When the remote cannot be reached it fails closed. Never throws.
export function landedCommitRefusal(
  cwd: string,
  name: string,
  value: string,
  base: string,
  approved?: ApprovedWork,
): string | undefined {
  const words = [...new Set((value.match(HASH) ?? []).map((id) => id.toLowerCase()))];
  const said = `${name} says "${value.trim().slice(0, 60)}"`;
  if (words.length === 0) {
    return `${said}, which is no commit: write the short hash of the commit of ${base} (git rev-parse --short ${base}).`;
  }
  const commits = words.flatMap((word) => {
    const full = commitOf(cwd, word);
    return full === undefined ? [] : [{ word, full }];
  });
  if (commits.length === 0) {
    return `${name}: no commit ${words[0]} in this checkout. Write the short hash of the commit of ${base} (git rev-parse --short ${base}), from the checkout that has it.`;
  }
  const listed = commits.map((each) => each.word).join(', ');
  const remote = remoteOfBase(cwd, base);
  const upstream = remote === undefined ? undefined : `${remote}/${base}`;
  if (remote !== undefined) {
    const fetched = run(
      cwd,
      'fetch',
      '--quiet',
      '--no-tags',
      remote,
      `+refs/heads/${base}:refs/remotes/${remote}/${base}`,
    );
    // A remote with no base yet holds nothing: the commits below are then not pushed.
    if ('error' in fetched && !/couldn't find remote ref/i.test(fetched.error)) {
      return `${name}: could not reach ${remote} (${fetched.error}), so Otea cannot tell whether ${listed} is on ${upstream}. Check the connection and hand it off again in a moment.`;
    }
  }
  const local = commitOf(cwd, `refs/heads/${base}`);
  for (const { word, full } of commits) {
    if (upstream === undefined) {
      if (local === undefined) {
        return `${name}: this checkout has no ${base}, so ${word} cannot be one of its commits.`;
      }
      if (!holds(cwd, local, full)) {
        return `${name}: commit ${word} is not in ${base}. Write the hash of a commit that is (git rev-parse --short ${base}).`;
      }
      continue;
    }
    const onRemote = (git(cwd, 'branch', '-r', '--contains', full) ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(upstream);
    if (onRemote) continue;
    if (local !== undefined && holds(cwd, local, full)) {
      return `${name}: commit ${word} is in your local ${base} but not on ${upstream}, so it is not pushed. Push it first (git push ${remote} ${base}); a push the hook refused did not reach ${remote}. Then hand it off again.`;
    }
    return `${name}: commit ${word} is not on ${upstream}. Write the hash of a commit of ${base} that is pushed (git rev-parse --short ${upstream}).`;
  }
  if (approved === undefined || approved.unchanged) return undefined;
  const work = commitOf(cwd, approved.commit);
  if (work === undefined) {
    return `${name}: this checkout lacks the commit the person approved (${approved.commit.slice(0, 7)}), so it cannot tell that ${listed} holds it. Fetch it, then hand it off again.`;
  }
  if (commits.some(({ full }) => holds(cwd, full, work) || landedIn(cwd, work, full))) {
    return undefined;
  }
  return `${name}: ${listed} does not hold the work the person approved (${work.slice(0, 7)}): it is an older commit of ${base}. Write the hash of the commit where that work landed (git rev-parse --short ${base} once it is there).`;
}
