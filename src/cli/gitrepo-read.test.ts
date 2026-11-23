import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkedOutBranch, currentBranch, inMainCheckout } from './gitrepo.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

// Where the checkout is and which branch it has, which the command reads from the .git folder
// instead of spawning git (three spawns on every otea next and otea claim).
describe('the checkout and its branch, read without asking git', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function tempDir(): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-read-')));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  function repo(): string {
    const dir = join(tempDir(), 'main');
    mkdirSync(dir);
    git(dir, 'init', '--quiet', '-b', 'main');
    return dir;
  }

  // The same answers with no git on the PATH as with it: the files were read.
  function withoutGit<T>(fn: () => T): T {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      return fn();
    } finally {
      process.env.PATH = path;
    }
  }

  it('names the branch of a main checkout, a linked worktree and a subfolder', () => {
    const dir = repo();
    git(dir, 'commit', '--allow-empty', '-m', 'init');
    git(dir, 'switch', '--quiet', '-c', 'feat/some-branch');
    mkdirSync(join(dir, 'sub'));
    const worktree = join(tempDir(), 'wt');
    git(dir, 'worktree', 'add', '--quiet', '-b', 'other', worktree);

    expect(withoutGit(() => currentBranch(dir))).toBe('feat/some-branch');
    expect(withoutGit(() => currentBranch(join(dir, 'sub')))).toBe('feat/some-branch');
    expect(withoutGit(() => checkedOutBranch(worktree))).toBe('other');
    expect(currentBranch(worktree)).toBe(git(worktree, 'symbolic-ref', '--short', 'HEAD'));
  });

  it('names the branch before the first commit', () => {
    const dir = repo();
    expect(withoutGit(() => currentBranch(dir))).toBe('main');
  });

  it('leaves a detached HEAD to git, which names no branch', () => {
    const dir = repo();
    git(dir, 'commit', '--allow-empty', '-m', 'init');
    git(dir, 'checkout', '--quiet', '--detach');
    expect(checkedOutBranch(dir)).toBeUndefined();
    expect(() => currentBranch(dir)).toThrow('no branch checked out here');
    // With no git to ask, the HEAD file (a commit, no ref) gives it no branch to name either.
    expect(withoutGit(() => checkedOutBranch(dir))).toBeUndefined();
    expect(() => withoutGit(() => currentBranch(dir))).toThrow('no branch checked out here');
  });

  it('names the branch, not git`s heads/<name>, when a tag has the same name', () => {
    // `git symbolic-ref --short` answers heads/main there, which no gate would find in its list of
    // branches: the name of the branch is what the HEAD file says, and what is pinned here.
    const dir = repo();
    git(dir, 'commit', '--allow-empty', '-m', 'init');
    git(dir, 'tag', 'main');
    expect(withoutGit(() => currentBranch(dir))).toBe('main');
    expect(withoutGit(() => checkedOutBranch(dir))).toBe('main');
  });

  it('asks git, which follows its own variables, when GIT_DIR is set', () => {
    const here = repo();
    git(here, 'switch', '--quiet', '-c', 'here-branch');
    const other = repo();
    git(other, 'switch', '--quiet', '-c', 'other-branch');
    const set = process.env.GIT_DIR;
    process.env.GIT_DIR = join(other, '.git');
    try {
      // GIT_DIR points git at the other repo, whatever folder the call runs in.
      expect(checkedOutBranch(here)).toBe('other-branch');
      expect(withoutGit(() => checkedOutBranch(here))).toBeUndefined();
    } finally {
      if (set === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = set;
    }
  });

  it('asks git when the refs are a reftable, whose HEAD file names no branch', () => {
    const dir = repo();
    expect(withoutGit(() => checkedOutBranch(dir))).toBe('main');
    mkdirSync(join(dir, '.git', 'reftable'));
    expect(withoutGit(() => checkedOutBranch(dir))).toBeUndefined();
  });

  it('tells a main checkout from a linked worktree', () => {
    const dir = repo();
    git(dir, 'commit', '--allow-empty', '-m', 'init');
    mkdirSync(join(dir, 'sub'));
    const worktree = join(tempDir(), 'wt');
    git(dir, 'worktree', 'add', '--quiet', worktree);

    expect(withoutGit(() => inMainCheckout(dir))).toBe(true);
    expect(withoutGit(() => inMainCheckout(join(dir, 'sub')))).toBe(true);
    expect(withoutGit(() => inMainCheckout(worktree))).toBe(false);
  });

  it('says it is no main checkout, and has no branch, outside a repo', () => {
    const dir = tempDir();
    expect(inMainCheckout(dir)).toBe(false);
    expect(checkedOutBranch(dir)).toBeUndefined();
    expect(withoutGit(() => inMainCheckout(dir))).toBe(false);
    expect(withoutGit(() => checkedOutBranch(dir))).toBeUndefined();
  });

  it('leaves a bare repo inside a checkout to git', () => {
    const outer = repo();
    git(outer, 'commit', '--allow-empty', '-m', 'init');
    git(outer, 'switch', '--quiet', '-c', 'outer-branch');
    const bare = join(outer, 'mirror.git');
    git(outer, 'init', '--quiet', '--bare', '-b', 'bare-branch', bare);
    // git takes the bare repo as the repo of this folder, not the checkout around it: climbing to
    // the checkout would answer outer-branch.
    expect(checkedOutBranch(bare)).toBe('bare-branch');
    expect(currentBranch(bare)).toBe('bare-branch');
  });
});
