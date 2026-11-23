import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commonDirByWalking, gitCommonDir } from './project.ts';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
const commit = (repo: string) => git(repo, 'commit', '--allow-empty', '-m', 'init');

// What git itself answers, which finding the common dir without it has to agree with.
const askGit = (cwd: string) => resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir').trim());

describe('gitCommonDir without asking git', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function tempDir(): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-common-')));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  function repoWithWorktree() {
    const repo = join(tempDir(), 'main');
    mkdirSync(repo);
    git(repo, 'init', '--quiet', '-b', 'main');
    commit(repo);
    const worktree = join(tempDir(), 'wt');
    git(repo, 'worktree', 'add', '--quiet', worktree);
    mkdirSync(join(repo, 'a', 'b'), { recursive: true });
    mkdirSync(join(worktree, 'a', 'b'), { recursive: true });
    return { repo, worktree };
  }

  it('gives what git gives, from the top, a subfolder and a linked worktree', () => {
    const { repo, worktree } = repoWithWorktree();
    for (const cwd of [repo, join(repo, 'a', 'b'), worktree, join(worktree, 'a', 'b')]) {
      expect(commonDirByWalking(cwd, {})).toBe(askGit(cwd));
    }
  });

  it('gives what git gives in a submodule', () => {
    const base = tempDir();
    const inner = join(base, 'inner');
    mkdirSync(inner);
    git(inner, 'init', '--quiet', '-b', 'main');
    commit(inner);
    const outer = join(base, 'outer');
    mkdirSync(outer);
    git(outer, 'init', '--quiet', '-b', 'main');
    commit(outer);
    git(outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', inner, 'sub');
    const sub = join(outer, 'sub');
    expect(commonDirByWalking(sub, {})).toBe(askGit(sub));
  });

  it.skipIf(process.platform === 'win32')(
    'gives what git gives from a folder reached by a link',
    () => {
      const { repo } = repoWithWorktree();
      const link = join(tempDir(), 'link');
      symlinkSync(repo, link);
      for (const cwd of [link, join(link, 'a', 'b')]) {
        expect(commonDirByWalking(cwd, {})).toBe(askGit(cwd));
      }
    },
  );

  it('does not run git when it can tell', () => {
    const { repo, worktree } = repoWithWorktree();
    const expected = [askGit(repo), askGit(worktree)];
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      expect([gitCommonDir(repo), gitCommonDir(worktree)]).toEqual(expected);
    } finally {
      process.env.PATH = path;
    }
  });

  it('leaves it to git when it is not sure', () => {
    const { repo } = repoWithWorktree();
    // git's own variables decide where its dir is.
    expect(commonDirByWalking(repo, { GIT_DIR: join(repo, '.git') })).toBeUndefined();
    // A .git that is not one (no HEAD): git says it is no repo, and so does gitCommonDir.
    const fake = tempDir();
    mkdirSync(join(fake, '.git'));
    expect(commonDirByWalking(fake, {})).toBeUndefined();
    expect(gitCommonDir(fake)).toBe(askGitOrUndefined(fake));
    // A .git with a HEAD but no objects/ or refs/ is no repo either.
    const hollow = tempDir();
    mkdirSync(join(hollow, '.git'));
    writeFileSync(join(hollow, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    expect(commonDirByWalking(hollow, {})).toBeUndefined();
    mkdirSync(join(hollow, '.git', 'objects'));
    expect(commonDirByWalking(hollow, {})).toBeUndefined();
    mkdirSync(join(hollow, '.git', 'refs'));
    expect(commonDirByWalking(hollow, {})).toBe(join(hollow, '.git'));
    // A .git file that points at nothing.
    const broken = tempDir();
    writeFileSync(join(broken, '.git'), 'gitdir: ./nowhere\n');
    expect(commonDirByWalking(broken, {})).toBeUndefined();
  });

  it('leaves a bare repo inside a checkout to git, which takes it as its own repo', () => {
    const { repo } = repoWithWorktree();
    const bare = join(repo, 'mirror.git');
    git(repo, 'init', '--quiet', '--bare', bare);
    mkdirSync(join(bare, 'refs', 'deeper'), { recursive: true });
    for (const cwd of [bare, join(bare, 'refs', 'deeper')]) {
      expect(commonDirByWalking(cwd, {})).toBeUndefined();
      expect(gitCommonDir(cwd)).toBe(askGit(cwd));
    }
    // And the folder inside a .git of its own.
    const hooks = join(repo, '.git', 'hooks');
    expect(commonDirByWalking(hooks, {})).toBeUndefined();
    expect(gitCommonDir(hooks)).toBe(askGitOrUndefined(hooks));
  });

  it('is undefined outside a repo', () => {
    const dir = tempDir();
    expect(gitCommonDir(dir)).toBe(askGitOrUndefined(dir));
  });
});

function askGitOrUndefined(cwd: string): string | undefined {
  try {
    return askGit(cwd);
  } catch {
    return undefined;
  }
}
