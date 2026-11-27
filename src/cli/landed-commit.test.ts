import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baseTipsOf, landedCommitRefusal, type Ownership } from './landed-commit.ts';

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
  const write = (file: string, content: string, message = file) => {
    writeFileSync(join(dir, file), content);
    git(dir, 'add', file);
    git(dir, 'commit', '-q', '-m', message);
  };
  const append = (file: string, line: string) => {
    appendFileSync(join(dir, file), `${line}\n`);
    git(dir, 'add', file);
    git(dir, 'commit', '-q', '-m', line);
  };
  const refusal = (value: string) => landedCommitRefusal(dir, 'Commit pushed', value, 'main');

  // The repos the tests start from are made once, by the commands a test used to run before its
  // own (a dozen git spawns, or twenty with the approved branch: seconds each on a Windows runner),
  // and each test gets a copy of the folder, with origin pointing at its own bare repo.
  const BRANCH = 'feat';
  const starts = { plain: '', pushed: '', branched: '' };
  let approvedTip = '';
  const tempRoot = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-landed-')));
  const layout = (folder: string) => {
    root = folder;
    dir = join(root, 'checkout');
    origin = join(root, 'origin.git');
  };
  const snapshot = (from: string) => {
    const copy = tempRoot();
    cpSync(from, copy, { recursive: true });
    return copy;
  };
  const startFrom = (template: string) => {
    layout(snapshot(template));
    if (existsSync(origin)) git(dir, 'remote', 'set-url', 'origin', origin);
  };

  beforeAll(() => {
    layout(tempRoot());
    execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { stdio: 'ignore' });
    starts.plain = snapshot(root);
    execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
    commit('root.txt');
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'push', '-q', 'origin', 'main');
    starts.pushed = snapshot(root);
    // The item's branch: two commits, one of them on a file another item will touch. Handed off
    // and approved at its tip, which is what the review read (pushed).
    write('shared.txt', 'one\ntwo\n', 'shared');
    git(dir, 'push', '-q', 'origin', 'main');
    git(dir, 'switch', '-q', '-c', BRANCH);
    write('feature.txt', 'feature\n');
    append('shared.txt', 'item line');
    git(dir, 'push', '-q', 'origin', BRANCH);
    approvedTip = git(dir, 'rev-parse', 'HEAD');
    // Another item landed on main meanwhile.
    git(dir, 'switch', '-q', 'main');
    starts.branched = snapshot(root);
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }, 90_000);
  afterAll(() => {
    for (const template of Object.values(starts)) {
      rmSync(template, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }));

  describe('in a repo with no remote', () => {
    beforeEach(() => startFrom(starts.plain));

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

    // A config of the person's that hides submodule changes (diff.ignoreSubmodules) made a commit
    // that only moves a submodule look empty: what is asked of git must not depend on it.
    it('takes a commit that only moves a submodule, whatever the diff config says', () => {
      commit('a.txt');
      git(dir, 'config', 'diff.ignoreSubmodules', 'all');
      git(
        dir,
        'update-index',
        '--add',
        '--cacheinfo',
        `160000,${git(dir, 'rev-parse', 'HEAD')},vendor/lib`,
      );
      git(dir, 'commit', '-q', '-m', 'bump the submodule');
      const bumped = git(dir, 'rev-parse', '--short', 'HEAD');
      expect(refusal(bumped)).toBeUndefined();
    });
  });

  describe('in a repo with a remote', () => {
    // A bare origin, and a checkout with a root commit pushed to it.
    beforeEach(() => startFrom(starts.pushed));

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

    // P1-F2: git commit --allow-empty gave the persona a new hash of main of its own: it passed
    // every check, and the item went Done with no change landed.
    it('refuses a commit that changes no files, though it is new, pushed and builds on the approved work', () => {
      commit('a.txt');
      const approved = { commit: git(dir, 'rev-parse', 'HEAD') };
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'nothing');
      const empty = git(dir, 'rev-parse', '--short', 'HEAD');
      git(dir, 'push', '-q', 'origin', 'main');
      const said = landedCommitRefusal(dir, 'Commit pushed', empty, 'main', approved);
      expect(said).toContain(`commit ${empty} changes no files`);
      expect(said).toContain('--allow-empty');
      expect(landedCommitRefusal(dir, 'Commit pushed', empty, 'main')).toContain(
        'changes no files',
      );
      // One that changes a file is fine, and so is the empty one named beside it.
      const real = commit('b.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      expect(landedCommitRefusal(dir, 'Commit pushed', real, 'main', approved)).toBeUndefined();
      expect(
        landedCommitRefusal(dir, 'Commit pushed', `${real} after ${empty}`, 'main', approved),
      ).toBeUndefined();
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

    // Field study, the Land step: the approved branch tip stops being main's ancestor once the
    // agent rebased it (a multi-commit branch, or a rebase that had a conflict to resolve), and
    // the refusal called main's own tip «an older commit of main».
    describe('landing the approved branch after main moved on', () => {
      const head = () => git(dir, 'rev-parse', '--short', 'HEAD');
      const ask = (value: string, tip: string) =>
        landedCommitRefusal(dir, 'Commit on main', value, 'main', { commit: tip });
      // The item's branch (made once, in beforeAll): two commits, one of them on a file another
      // item will touch, pushed and handed off at its tip, which is what the review read.
      let approved: string;
      beforeEach(() => {
        startFrom(starts.branched);
        approved = approvedTip;
      });
      const mainMovesOnAnotherFile = () => {
        write('other.txt', 'other\n');
        git(dir, 'push', '-q', 'origin', 'main');
      };
      const mainTouchesTheSameLines = () => {
        append('shared.txt', 'other line');
        git(dir, 'push', '-q', 'origin', 'main');
      };
      // What an agent does with a conflict: keeps both lines.
      const rebaseKeepingBoth = () => {
        git(dir, 'switch', '-q', BRANCH);
        expect(() => git(dir, 'rebase', 'main')).toThrow();
        writeFileSync(join(dir, 'shared.txt'), 'one\ntwo\nother line\nitem line\n');
        git(dir, 'add', 'shared.txt');
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'rebase', '--continue'], {
          cwd: dir,
          stdio: 'pipe',
          env: { ...process.env, GIT_EDITOR: 'true' },
        });
      };
      const landBranchOnMain = () => {
        git(dir, 'switch', '-q', 'main');
        git(dir, 'merge', '-q', '--ff-only', BRANCH);
        git(dir, 'push', '-q', 'origin', 'main');
        return head();
      };

      const mergeMainIn = () => {
        git(dir, 'switch', '-q', BRANCH);
        git(dir, 'fetch', '-q', 'origin');
        git(dir, 'merge', '-q', '--no-edit', 'origin/main');
      };

      it('takes the tip of a multi-commit branch rebased onto the new main', () => {
        mainMovesOnAnotherFile();
        git(dir, 'switch', '-q', BRANCH);
        git(dir, 'rebase', '-q', 'main');
        const landed = landBranchOnMain();
        expect(ask(landed, approved)).toBeUndefined();
      });

      // A rebase with a conflict resolved by hand is not the approved change: git cannot merge the
      // approved commit back into it, nothing says the resolution kept what was approved, and the
      // push gate refuses it too. Land by merging main into the branch instead.
      it('refuses a rebase whose conflict was resolved by hand, pointing to the merge-based Land', () => {
        mainTouchesTheSameLines();
        rebaseKeepingBoth();
        const landed = landBranchOnMain();
        const said = ask(landed, approved);
        expect(said).toContain('does not hold the work the person approved');
        expect(said).toContain('git cannot merge the two');
        expect(said).toContain('git merge origin/main');
        expect(said).not.toContain('older commit');
      });

      it('takes the merge of main into the branch', () => {
        mainMovesOnAnotherFile();
        mergeMainIn();
        git(dir, 'push', '-q', 'origin', BRANCH);
        expect(ask(landBranchOnMain(), approved)).toBeUndefined();
      });

      it('takes the merge of main into the branch with the conflict resolved', () => {
        mainTouchesTheSameLines();
        git(dir, 'switch', '-q', BRANCH);
        git(dir, 'fetch', '-q', 'origin');
        expect(() => git(dir, 'merge', '--no-edit', 'origin/main')).toThrow();
        writeFileSync(join(dir, 'shared.txt'), 'one\ntwo\nother line\nitem line\n');
        git(dir, 'add', 'shared.txt');
        git(dir, 'commit', '-q', '--no-edit');
        const resolved = landBranchOnMain();
        expect(ask(resolved, approved)).toBeUndefined();
      });

      it('still refuses an older commit of main, saying so', () => {
        const older = git(dir, 'rev-parse', '--short', 'origin/main');
        mainMovesOnAnotherFile();
        git(dir, 'switch', '-q', BRANCH);
        git(dir, 'rebase', '-q', 'main');
        landBranchOnMain();
        const said = ask(older, approved);
        expect(said).toContain('does not hold the work the person approved');
        expect(said).toContain('older commit of main');
      });

      // Another commit that landed after the branch forked is built on the same base but carries
      // none of the approved change: it names what is missing.
      it("refuses another item's later commit, saying what of the approved change is missing", () => {
        mainMovesOnAnotherFile();
        const other = head();
        const said = ask(other, approved);
        expect(said).toContain('does not hold the work the person approved');
        expect(said).toContain('part of the approved change is missing');
        expect(said).toContain('feature.txt');
        expect(said).not.toContain('older commit');
      });

      // The agent fast-forwarded main only to the first commit of the approved branch: that is a
      // partial landing, not «an older commit of main», whatever the hash it wrote.
      it('calls main moved only to an earlier commit of the approved branch a partial landing', () => {
        const claimTips = baseTipsOf(dir, 'main');
        git(dir, 'push', '-q', 'origin', `${approved}~1:main`);
        git(dir, 'fetch', '-q', 'origin');
        const first = git(dir, 'rev-parse', '--short', 'origin/main');
        const said = landedCommitRefusal(
          dir,
          'Commit on main',
          first,
          'main',
          { commit: approved },
          { landed: [], claimTips },
        );
        expect(said).toContain('does not hold the work the person approved');
        expect(said).toContain('a partial landing');
        expect(said).not.toContain('older commit');
        // With the base tips of the claim unknown, an earlier commit can be either; it says so.
        expect(ask(first, approved)).toContain('a partial landing');
      });

      // The work is on main already, at a later commit: an older hash is just that.
      it('calls an earlier commit an older commit once the approved work is on main', () => {
        const older = git(dir, 'rev-parse', '--short', 'origin/main');
        landBranchOnMain();
        const said = ask(older, approved);
        expect(said).toContain('older commit of main');
        expect(said).toContain('later commit');
      });

      // An approved branch that nets out to no change from where it diverged (a commit and its
      // revert) has nothing another commit could hold: it says that, not «changes no files».
      it('refuses to tell any commit holds an approved change that nets out to nothing', () => {
        git(dir, 'switch', '-q', BRANCH);
        git(dir, 'revert', '--no-edit', 'HEAD~1');
        git(dir, 'revert', '--no-edit', 'HEAD~1');
        git(dir, 'push', '-q', 'origin', BRANCH);
        const netted = git(dir, 'rev-parse', 'HEAD');
        git(dir, 'switch', '-q', 'main');
        mainMovesOnAnotherFile();
        const said = ask(head(), netted);
        expect(said).toContain('leaves the files as they were');
        expect(said).not.toContain('changes no files');
      });

      // What a clean merge can still miss when only a line is deleted, only whitespace changes, a
      // line duplicates one already there, or only a file mode changes: the named commit lacks the
      // change, so merging the approved commit into it would still change the file.
      describe.each([
        ['deletes a line', 'keep.txt', () => writeFileSync(join(dir, 'keep.txt'), 'a\nb\n')],
        [
          'only changes whitespace',
          'keep.txt',
          () => writeFileSync(join(dir, 'keep.txt'), 'a\n  secret=x\nb\n'),
        ],
        [
          'adds a line that duplicates another',
          'keep.txt',
          () => writeFileSync(join(dir, 'keep.txt'), 'a\nsecret=x\nb\na\n'),
        ],
        [
          'only changes a file mode',
          'run.sh',
          () => {
            chmodSync(join(dir, 'run.sh'), 0o755);
            git(dir, 'update-index', '--chmod=+x', 'run.sh');
          },
        ],
      ])('an approved change that %s', (_what, file, change) => {
        it('is refused for a commit of main that lacks it, and taken when main has it', () => {
          write('keep.txt', 'a\nsecret=x\nb\n');
          write('run.sh', 'echo hi\n');
          git(dir, 'push', '-q', 'origin', 'main');
          git(dir, 'switch', '-q', '-c', 'item');
          change();
          // Only keep.txt is staged here: «git add -A» would put a mode change back as the
          // working tree has it, which a filesystem that keeps modes does not show as changed.
          git(dir, 'add', 'keep.txt');
          git(dir, 'commit', '-q', '-m', 'the change');
          git(dir, 'push', '-q', 'origin', 'item');
          const tip = git(dir, 'rev-parse', 'HEAD');
          git(dir, 'switch', '-q', 'main');
          mainMovesOnAnotherFile();
          const said = ask(head(), tip);
          expect(said).toContain('part of the approved change is missing');
          expect(said).toContain(file);
          // Landing it (main fast-forwarded to the branch, after main's change was merged in).
          git(dir, 'switch', '-q', 'item');
          git(dir, 'merge', '-q', '--no-edit', 'main');
          git(dir, 'push', '-q', 'origin', 'item');
          git(dir, 'switch', '-q', 'main');
          git(dir, 'merge', '-q', '--ff-only', 'item');
          git(dir, 'push', '-q', 'origin', 'main');
          expect(ask(head(), tip)).toBeUndefined();
        });
      });

      // A merge that keeps main's side whole adds nothing to main: a new hash, no work landed.
      it('refuses a merge that kept main as it was', () => {
        mainMovesOnAnotherFile();
        git(dir, 'merge', '-q', '-s', 'ours', '--no-edit', approved);
        git(dir, 'push', '-q', 'origin', 'main');
        expect(ask(head(), approved)).toContain('changes no files');
      });
    });
  });

  // P1-F3: an item that made no commit went Done with the hash of main, which was another item's
  // commit. The commit must be this item's: not one another item landed with, and not one made
  // before the item was taken.
  describe('the commit must be this item’s own', () => {
    beforeEach(() => startFrom(starts.plain));
    const ask = (value: string, own: Ownership, approved?: { commit: string }) =>
      landedCommitRefusal(dir, 'Commit pushed', value, 'main', approved, own);
    const head = () => git(dir, 'rev-parse', 'HEAD');

    it('refuses a commit an item that landed already wrote, by any of its spellings', () => {
      const first = commit('a.txt');
      const landed = [{ id: 'MN-3', value: `landed as ${first}` }];
      for (const said of [first, head(), `main is at ${first.toUpperCase()}`]) {
        expect(ask(said, { landed })).toContain('is already the commit MN-3 landed with');
      }
      // With nobody holding it it is fine, and so is another commit of main.
      expect(ask(first, { landed: [] })).toBeUndefined();
      expect(ask(commit('b.txt'), { landed })).toBeUndefined();
    });

    // An empty commit of its own is no work: beside the real commit another item landed, it must
    // not stand for the item's own commit (round-7 review of P1-F2).
    it('does not take an empty commit beside a commit another item landed', () => {
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'nothing');
      const empty = git(dir, 'rev-parse', '--short', 'HEAD');
      const theirs = commit('a.txt');
      const landed = [{ id: 'MN-3', value: theirs }];
      expect(ask(`${empty} ${theirs}`, { landed })).toContain(
        `commit ${theirs} is already the commit MN-3 landed with`,
      );
      expect(ask(`${theirs} ${empty}`, { landed })).toContain('is already the commit MN-3');
      // With its own real commit named too, the empty one is only context.
      const mine = commit('b.txt');
      expect(ask(`${empty} ${mine}`, { landed })).toBeUndefined();
    });

    // The base as it stood when the item was first claimed holds nothing of the item's work.
    it('refuses a commit the base held when the item was claimed, and takes a later one', () => {
      const before = commit('a.txt');
      const claimTips = baseTipsOf(dir, 'main');
      const after = commit('b.txt');
      expect(ask(before, { landed: [], claimTips })).toContain(
        `commit ${before} was already on the base when this item was taken`,
      );
      expect(ask(after, { landed: [], claimTips })).toBeUndefined();
      // An older item recorded no tips: nothing to hold the commit to.
      expect(ask(before, { landed: [] })).toBeUndefined();
    });

    // The persona's case: the item made no commit, so its approved tip is main as it stood, the
    // commit of another item: it "holds the work", and was there before the item began.
    it('refuses main as it stood for an item that made no commit', () => {
      commit('base.txt');
      execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
      git(dir, 'remote', 'add', 'origin', origin);
      git(dir, 'push', '-q', 'origin', 'main');
      const theirs = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      const claimTips = baseTipsOf(dir, 'main');
      const approved = { commit: head() };
      expect(ask(theirs, { landed: [], claimTips }, approved)).toContain(
        'was already on the base when this item was taken',
      );
    });

    // Commits others pushed that this checkout has not merged were on the base before the item
    // began: the remote-tracking tip is recorded too, and a commit only origin/main holds is refused.
    it('records the remote-tracking tip, and refuses a commit only origin/main holds', () => {
      commit('base.txt');
      execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
      git(dir, 'remote', 'add', 'origin', origin);
      git(dir, 'push', '-q', 'origin', 'main');
      const behind = head();
      const theirs = commit('a.txt');
      git(dir, 'push', '-q', 'origin', 'main');
      git(dir, 'reset', '-q', '--hard', behind);
      const tips = baseTipsOf(dir, 'main');
      expect(tips).toHaveLength(2);
      const own = (claimTips: string[]) => ({ landed: [], claimTips });
      // Against the local tip alone the commit looks new; against both tips it was already there.
      expect(ask(theirs, own([behind]))).toBeUndefined();
      expect(ask(theirs, own(tips))).toContain('was already on the base when this item was taken');
    });

    // A claim of B, then A commits and lands X: B writing X is refused, though X came after B's
    // claim (the date and clock of the machine tell nothing here).
    it('refuses what another item landed after this one was claimed', () => {
      commit('base.txt');
      const claimTips = baseTipsOf(dir, 'main');
      const x = commit('x.txt');
      expect(
        ask(x, { landed: [{ id: 'MN-3', value: x }], claimTips }, { commit: head() }),
      ).toContain('is already the commit MN-3 landed with');
    });

    // Only the commit that holds the approved work is judged: another hash in the text is context.
    it('does not judge a hash the value only mentions', () => {
      const context = commit('a.txt');
      const claimTips = baseTipsOf(dir, 'main');
      const mine = commit('b.txt');
      const approved = { commit: head() };
      const own = { landed: [{ id: 'MN-3', value: context }], claimTips };
      expect(ask(`${mine}, follows ${context}`, own, approved)).toBeUndefined();
      expect(ask(`follows ${context}, ${mine}`, own, approved)).toBeUndefined();
      // Naming only the other item's commit is no proof of this item's work.
      expect(ask(context, own, approved)).toContain('does not hold the work the person approved');
    });

    it('reads the hashes of every item that landed', () => {
      const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map(commit);
      const landed = [
        { id: 'MN-3', value: `${a} ${b}` },
        { id: 'MN-4', value: `${c}` },
      ];
      const refused = ask(`${a} ${b} ${c}`, { landed });
      expect(refused).toContain('landed with');
      expect(ask(`${c} deadbee`, { landed: [] })).toBeUndefined();
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
    layout(tempRoot());
    const sha256 = join(root, 'sha256');
    execFileSync('git', ['init', '--quiet', '-b', 'main', '--object-format=sha256', sha256], {
      stdio: 'ignore',
    });
    // The id's format is under test, not an empty commit: it changes a file.
    writeFileSync(join(sha256, 'x.txt'), 'x');
    execFileSync('git', ['add', 'x.txt'], { cwd: sha256, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], {
      cwd: sha256,
      stdio: 'ignore',
    });
    const full = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: sha256,
      encoding: 'utf8',
    }).trim();
    expect(full).toHaveLength(64);
    expect(landedCommitRefusal(sha256, 'Commit pushed', full, 'main')).toBeUndefined();
  });
});
