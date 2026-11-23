import { execFileSync } from 'node:child_process';

// What a board's «Commit pushed» (Commit en main) field claims: the commit it names reached the
// base the board protects. The field took any text, «banana» or the hash of a push the hook had
// refused, and the item went Done (P8-F1, P9-F5), so a handoff that records one checks it here.

const COMMIT_ID = /\b[0-9a-f]{7,40}\b/gi;
const FETCH_MS = 30_000;

function git(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: FETCH_MS,
    }).trim();
  } catch {
    return undefined;
  }
}

// Whether `ancestor` is in the history of `ref`.
function holds(cwd: string, ref: string, ancestor: string): boolean {
  return git(cwd, 'merge-base', '--is-ancestor', ancestor, ref) !== undefined;
}

function exists(cwd: string, ref: string): boolean {
  return git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== undefined;
}

// The remote a base is pushed to: origin, or the only remote there is.
function remoteOfBase(cwd: string, base: string): string | undefined {
  const remotes = (git(cwd, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  if (remotes.length === 0) return undefined;
  const named = git(cwd, 'config', '--get', `branch.${base}.remote`);
  if (named && remotes.includes(named)) return named;
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

// The refusal of a handoff whose `field` (the part named `name`) does not hold a commit of `base`
// as it stands now, or undefined when it does. With a remote, the commit must be on its branch of
// the base (git branch -r --contains, after a fetch): a push a hook refused is not there. With
// none, there is nothing to push, and the commit must be in the local base. `value` may name
// several commits; each must hold. Never throws.
export function landedCommitRefusal(
  cwd: string,
  name: string,
  value: string,
  base: string,
): string | undefined {
  const ids = [...new Set((value.match(COMMIT_ID) ?? []).map((id) => id.toLowerCase()))];
  const what = `${name} says "${value.trim().slice(0, 60)}"`;
  if (ids.length === 0) {
    return `${what}, which is no commit: write the short hash of the commit of ${base} (git rev-parse --short ${base}).`;
  }
  const remote = remoteOfBase(cwd, base);
  let fetchFailed = false;
  if (remote && git(cwd, 'fetch', '--quiet', remote) === undefined) fetchFailed = true;
  const upstream = remote ? `${remote}/${base}` : undefined;
  for (const id of ids) {
    if (!exists(cwd, id)) {
      return `${name}: no commit ${id} in this checkout. Write the short hash of the commit of ${base} (git rev-parse --short ${base}), from the checkout that has it.`;
    }
    if (upstream === undefined) {
      if (!exists(cwd, `refs/heads/${base}`)) {
        return `${name}: this checkout has no ${base}, so ${id} cannot be one of its commits.`;
      }
      if (!holds(cwd, `refs/heads/${base}`, id)) {
        return `${name}: commit ${id} is not in ${base}. Write the hash of a commit that is (git rev-parse --short ${base}).`;
      }
      continue;
    }
    const onRemote = (git(cwd, 'branch', '-r', '--contains', id) ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(upstream);
    if (onRemote) continue;
    const local = exists(cwd, `refs/heads/${base}`) && holds(cwd, `refs/heads/${base}`, id);
    const why = fetchFailed
      ? ` (${remote} could not be fetched, so this is what this checkout last saw of it)`
      : '';
    if (local) {
      return `${name}: commit ${id} is in your local ${base} but not on ${upstream}${why}, so it is not pushed. Push it first (git push ${remote} ${base}); a push the hook refused did not reach ${remote}. Then hand it off again.`;
    }
    return `${name}: commit ${id} is not on ${upstream}${why}. Write the hash of a commit of ${base} that is pushed (git rev-parse --short ${upstream}).`;
  }
  return undefined;
}
