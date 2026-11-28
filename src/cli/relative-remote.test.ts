import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeTake } from './gitrepo.ts';

// U6 (field study 4, wave 2b): the remote was `../origin.git`, which git resolves from the folder it
// runs in; run from a worktree under .otea/worktrees the merge gate asked a folder that is no
// repository and refused («could not check ... does not appear to be a git repository»).
describe('the merge gate with a remote given by a relative path, asked from a worktree', () => {
  let box: string;
  let repo: string;
  let worktree: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

  beforeEach(() => {
    box = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-relremote-')));
    repo = join(box, 'repo');
    mkdirSync(repo);
    git(box, 'init', '--quiet', '--bare', 'origin.git');
    git(repo, 'init', '--quiet', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'a');
    git(repo, 'remote', 'add', 'origin', '../origin.git');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', 'cambio/uno');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'b');
    git(repo, 'push', '-q', 'origin', 'cambio/uno');
    git(repo, 'checkout', '-q', 'main');
    worktree = join(repo, '.otea', 'worktrees', 'CAM-1');
    git(repo, 'worktree', 'add', '-q', worktree, 'cambio/uno');
  });

  afterEach(() => rmSync(box, { recursive: true, force: true, maxRetries: 10 }));

  it('reads the remote as from the repository root, not from the worktree', () => {
    const commit = git(repo, 'rev-parse', 'cambio/uno');
    const tree = git(repo, 'rev-parse', 'cambio/uno^{tree}');
    const take = mergeTake(worktree, { branch: 'cambio/uno', commit, tree }, 'main');
    expect(take).not.toHaveProperty('unknown');
    expect(take).toMatchObject({ held: true });
  });
});
