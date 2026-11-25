import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TempRepo, tempGitRepo } from '../cli/testing.ts';
import { filesChangedAt } from './branch-files.ts';

// The files a branch changes over its base, from what git has pushed and nothing fetched: the
// ground of the warning that two items touch the same files.
describe('the files a branch changes over its base', () => {
  let repo: TempRepo;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo.dir,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const commit = (file: string) => {
    repo.write(file, `${file}\n`);
    git('add', file);
    git('commit', '-q', '-m', file);
  };

  beforeEach(() => {
    repo = tempGitRepo();
    commit('root.txt');
    git('branch', '-M', 'main');
    git('checkout', '-q', '-b', 'feat/x');
    commit('src/a.ts');
    commit('src/b.ts');
    // The base moved on after the branch left it: its own change is not the branch's.
    git('checkout', '-q', 'main');
    commit('src/moved.ts');
    git('checkout', '-q', 'feat/x');
  });

  afterEach(() => repo.remove());

  it('lists what the branch changes since it left the base, not what the base gained', () => {
    expect(filesChangedAt(repo.dir)('feat/x', 'main')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('counts a branch only once it is pushed, in a repo that has a remote', () => {
    git('remote', 'add', 'origin', 'https://example.invalid/x.git');
    expect(filesChangedAt(repo.dir)('feat/x', 'main')).toBeUndefined();

    git('update-ref', 'refs/remotes/origin/feat/x', 'feat/x');
    expect(filesChangedAt(repo.dir)('feat/x', 'main')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('reads the branch as pushed, not as it stands here', () => {
    git('update-ref', 'refs/remotes/origin/feat/x', 'feat/x');
    commit('src/later.ts');

    expect(filesChangedAt(repo.dir)('feat/x', 'main')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('says nothing of a branch that does not exist', () => {
    expect(filesChangedAt(repo.dir)('feat/none', 'main')).toBeUndefined();
  });
});
