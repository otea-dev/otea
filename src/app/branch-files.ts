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
