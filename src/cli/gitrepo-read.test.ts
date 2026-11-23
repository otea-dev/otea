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
  });
});
