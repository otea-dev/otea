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

    // The remote cannot be asked: fail closed, saying so, never «push it first».
    it('fails closed, saying to try again, when the remote cannot be reached', () => {
      const pushed = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      git(dir, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
      const said = refusal(pushed);
      expect(said).toContain('could not reach origin');
      expect(said).toContain('hand it off again in a moment');
      expect(said).not.toMatch(/push it first/i);
    });

    // A value may name several commits: each must be pushed, and a hex-looking word that is no
    // commit of this checkout is no hash.
    it('holds every commit a value names, and ignores a word that is no commit', () => {
      const first = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      const second = commit('b.txt');
      expect(refusal(`${first} and ${second}`)).toContain(`commit ${second} is in your local main`);
      git(dir, 'push', '-q', 'origin', 'main');
      expect(refusal(`${first} and ${second}`)).toBeUndefined();
      expect(refusal(`landed ${second} (decaded)`)).toBeUndefined();
      expect(refusal('decaded')).toMatch(/no commit decaded in this checkout/);
    });

    // The commit written must hold what the person approved, not just be some pushed commit:
    // git rev-parse origin/main before the push is a real, pushed, older commit.
    it('refuses an older commit of main for the work that was approved', () => {
      const old = git(dir, 'rev-parse', '--short', 'origin/main');
      const work = commit('a.txt');
      const approved = { commit: git(dir, 'rev-parse', 'HEAD') };
      // Before any push: the old hash is on origin/main, yet it is not the approved work.
      const early = landedCommitRefusal(dir, 'Commit pushed', old, 'main', approved);
      expect(early).toContain('does not hold the work the person approved');
      expect(early).toContain('older commit of main');
      expect(landedCommitRefusal(dir, 'Commit pushed', work, 'main', approved)).toContain(
        'is in your local main but not on origin/main',
      );
      git(dir, 'push', '-q', 'origin', 'main');
      expect(landedCommitRefusal(dir, 'Commit pushed', old, 'main', approved)).toContain(
        'does not hold the work the person approved',
      );
      expect(landedCommitRefusal(dir, 'Commit pushed', work, 'main', approved)).toBeUndefined();
      // A commit after it holds it too; so does one with the same changes (a rebase or squash).
      const later = commit('b.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      expect(landedCommitRefusal(dir, 'Commit pushed', later, 'main', approved)).toBeUndefined();
    });

    // The agent pushed main before handing off: the tip is then recorded as unchanged (main held
    // nothing the remote lacked), yet an older hash is still no proof of the work it did.
    it('still refuses an older hash when the agent pushed before handing off', () => {
      const old = git(dir, 'rev-parse', '--short', 'origin/main');
      const work = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      const approved = { commit: git(dir, 'rev-parse', 'HEAD') };
      expect(landedCommitRefusal(dir, 'Commit pushed', old, 'main', approved)).toContain(
        'does not hold the work the person approved',
      );
      expect(landedCommitRefusal(dir, 'Commit pushed', work, 'main', approved)).toBeUndefined();
    });

    // An approved change with no change in it is "contained" by any commit: the hash must also be
    // built on what it was built on.
    it('does not take any hash for an approved commit that changes nothing', () => {
      const older = git(dir, 'rev-parse', '--short', 'HEAD');
      commit('c1.txt');
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'nothing');
      const approved = { commit: git(dir, 'rev-parse', 'HEAD') };
      const after = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      expect(landedCommitRefusal(dir, 'Commit pushed', older, 'main', approved)).toContain(
        'does not hold the work the person approved',
      );
      expect(landedCommitRefusal(dir, 'Commit pushed', after, 'main', approved)).toBeUndefined();
    });

    // The remote has no main (deleted there) though this checkout still has the old origin/main
    // from its last fetch: that is no proof, the commit is not pushed.
    it('refuses when the remote has no base branch, whatever the stale ref says', () => {
      const pushed = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      git(origin, 'update-ref', '-d', 'refs/heads/main');
      expect(git(dir, 'branch', '-r', '--contains', pushed)).toContain('origin/main');
      const said = refusal(pushed);
      expect(said).toContain('origin has no main branch');
      expect(said).toContain('git push origin main');
    });
  });

  // P1-F3: an item that made no commit went Done with the hash of main, which was another item's
  // commit. The commit must be this item's: not one another item landed with, and not one made
  // before the item was taken.
  describe('the commit must be this item’s own', () => {
    const at = (iso: string) => ({ GIT_COMMITTER_DATE: iso, GIT_AUTHOR_DATE: iso });
    const commitOn = (file: string, iso: string) => {
      writeFileSync(join(dir, file), file);
      git(dir, 'add', file);
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file],
        { cwd: dir, stdio: 'pipe', env: { ...process.env, ...at(iso) } },
      );
      return git(dir, 'rev-parse', '--short', 'HEAD');
    };
    const claimed = (iso: string) => Date.parse(iso);

    it('refuses a commit another item already landed with, by any of its spellings', () => {
      const first = commit('a.txt');
      const full = git(dir, 'rev-parse', 'HEAD');
      const others = [{ id: 'MN-3', value: `landed as ${first}` }];
      for (const said of [first, full, `main is at ${first.toUpperCase()}`]) {
        const refused = landedCommitRefusal(dir, 'Commit pushed', said, 'main', undefined, {
          others,
        });
        expect(refused).toContain('is already the commit MN-3 landed with');
      }
      // The same commit, with nobody else holding it, is fine; so is another item's other commit.
      expect(
        landedCommitRefusal(dir, 'Commit pushed', first, 'main', undefined, { others: [] }),
      ).toBeUndefined();
      const second = commit('b.txt');
      expect(
        landedCommitRefusal(dir, 'Commit pushed', second, 'main', undefined, { others }),
      ).toBeUndefined();
    });

    it('refuses a commit made before the item was taken, and takes one made after', () => {
      const before = commitOn('a.txt', '2026-11-20T10:00:00Z');
      const after = commitOn('b.txt', '2026-11-20T12:00:00Z');
      const own = { others: [], claimedAt: claimed('2026-11-20T11:00:00Z') };
      const refused = landedCommitRefusal(dir, 'Commit pushed', before, 'main', undefined, own);
      expect(refused).toContain(`commit ${before} was made before this item was taken`);
      expect(
        landedCommitRefusal(dir, 'Commit pushed', after, 'main', undefined, own),
      ).toBeUndefined();
      // No claim to tell the time by: nothing to hold the commit to.
      expect(
        landedCommitRefusal(dir, 'Commit pushed', before, 'main', undefined, { others: [] }),
      ).toBeUndefined();
    });

    // The item made no commit: its approved tip is main as it stood, which is the other item's
    // commit. It holds that "work", yet it was made before the item was taken.
    it('refuses the tip of main at the handoff of an item that made no commit', () => {
      commit('base.txt');
      execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
      git(dir, 'remote', 'add', 'origin', origin);
      git(dir, 'push', '-q', 'origin', 'main');
      const theirs = commitOn('a.txt', '2026-11-20T10:00:00Z');
      git(dir, 'push', '-q', 'origin', 'main');
      const approved = { commit: git(dir, 'rev-parse', 'HEAD') };
      const own = { others: [], claimedAt: claimed('2026-11-20T11:00:00Z') };
      expect(landedCommitRefusal(dir, 'Commit pushed', theirs, 'main', approved, own)).toContain(
        'was made before this item was taken',
      );
    });
  });

  // A SHA-256 repository writes 64-digit ids. Skipped, visibly, where git cannot make one.
  const sha256Works = (() => {
    const probe = mkdtempSync(join(tmpdir(), 'otea-sha256-'));
    try {
      execFileSync('git', ['init', '--quiet', '--object-format=sha256', probe], {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();
  it.skipIf(!sha256Works)('takes a 64-digit id of a SHA-256 repository', () => {
    const sha256 = join(root, 'sha256');
    execFileSync('git', ['init', '--quiet', '-b', 'main', '--object-format=sha256', sha256], {
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'x'],
      {
        cwd: sha256,
        stdio: 'ignore',
      },
    );
    const full = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sha256,
      encoding: 'utf8',
    }).trim();
    expect(full).toHaveLength(64);
    expect(landedCommitRefusal(sha256, 'Commit pushed', full, 'main')).toBeUndefined();
  });
});
