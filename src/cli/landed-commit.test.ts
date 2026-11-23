import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { landedCommitRefusal } from './landed-commit.ts';

// P8-F1, P9-F5: «Commit pushed» took «banana», and the hash of a push the hook had refused. The
// commit a handoff records must exist, be in the base, and, where the repo has a remote, be on
// the remote's branch of it as the remote has it now.
describe('the commit a board says it landed', () => {
  let root: string;
  let dir: string;
  let origin: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const commit = (file: string) => {
    writeFileSync(join(dir, file), file);
    git(dir, 'add', file);
    git(dir, 'commit', '-q', '-m', file);
    return git(dir, 'rev-parse', '--short', 'HEAD');
  };
  const refusal = (value: string) => landedCommitRefusal(dir, 'Commit pushed', value, 'main');

  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-landed-')));
    dir = join(root, 'checkout');
    origin = join(root, 'origin.git');
    execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { stdio: 'ignore' });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));

  describe('in a repo with no remote', () => {
    it('takes a commit of the local main and nothing else', () => {
      const landed = commit('a.txt');
      expect(refusal(landed)).toBeUndefined();
      expect(refusal(`landed as ${landed}`)).toBeUndefined();

      expect(refusal('banana')).toMatch(/says "banana", which is no commit/);
      expect(refusal('deadbeef')).toMatch(/no commit deadbeef in this checkout/);
      git(dir, 'switch', '-q', '-c', 'side');
      const aside = commit('b.txt');
      expect(refusal(aside)).toMatch(new RegExp(`commit ${aside} is not in main`));
    });
  });

  describe('in a repo with a remote', () => {
    beforeEach(() => {
      execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
      commit('root.txt');
      git(dir, 'remote', 'add', 'origin', origin);
      git(dir, 'push', '-q', 'origin', 'main');
    });

    it('takes a commit that is on origin/main', () => {
      const pushed = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      expect(refusal(pushed)).toBeUndefined();
    });

    it('refuses a hash of a commit never pushed, as a push the hook refused leaves it', () => {
      const local = commit('a.txt');
      const said = refusal(local);
      expect(said).toContain(`commit ${local} is in your local main but not on origin/main`);
      expect(said).toContain('git push origin main');
      expect(refusal('banana')).toMatch(/which is no commit/);
    });

    it('asks the remote as it is now, not as this checkout last saw it', () => {
      const pushed = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      // The remote branch was reset behind this checkout's back: the stale origin/main still
      // holds the commit, the remote no longer does.
      git(origin, 'update-ref', 'refs/heads/main', git(dir, 'rev-parse', 'HEAD~1'));
      expect(refusal(pushed)).toContain('is in your local main but not on origin/main');
    });
  });
});
