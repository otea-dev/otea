import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processAlive } from '../app/presence.ts';
import { readServeFile } from './serve-file.ts';
import { type Cli, cliAt, spawnCli, tempGitRepo, until } from './testing.ts';

const AUTHOR = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

describe('uninstall', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  const git = (...args: string[]) =>
    execFileSync('git', [...AUTHOR, ...args], { cwd: repo.dir, stdio: 'pipe', encoding: 'utf8' });
  const status = () => git('status', '--porcelain');
  const read = (path: string) => readFileSync(join(repo.dir, path), 'utf8');
  const hookFile = () => join(repo.dir, '.git', 'hooks', 'pre-push');

  // The settings an older otea hook install --claude wrote beside a hook of the person's own.
  const MINE = { type: 'command', command: 'echo mine' };
  const OTEAS = { type: 'command', command: 'otea check --gate push --claude-hook' };
  const settings = (hooks: unknown[]) =>
    `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks }] } }, null, 2)}\n`;

  beforeEach(() => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
  });

  afterEach(() => repo.remove());

  it('leaves the repo as it was before init: only Otea’s hook, hooks and block go, and git status is clean', async () => {
    repo.write('AGENTS.md', '# Mine\n\nHouse rules.\n');
    repo.write('.claude/settings.local.json', settings([MINE]));
    git('add', '-A');
    git('commit', '--quiet', '-m', 'one');
    expect(status()).toBe('');

    expect((await otea('init', '--template', 'none', '--agents-md')).code).toBe(0);
    expect((await otea('hook', 'install', '--git')).code).toBe(0);
    repo.write('.claude/settings.local.json', settings([MINE, OTEAS]));
    expect(read('AGENTS.md')).toContain('<!-- otea:begin -->');
    expect(existsSync(hookFile())).toBe(true);
    expect(status()).not.toBe('');

    const result = await otea('uninstall', '--only', 'repos');

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Removed the pre-push hook ${hookFile()}`);
    expect(result.out).toContain('Removed the Otea hooks and allow rules in');
    expect(result.out).toContain("Removed Otea's block from");
    expect(result.out).toContain('Your Otea data stays in');
    expect(existsSync(hookFile())).toBe(false);
    expect(read('AGENTS.md')).toBe('# Mine\n\nHouse rules.\n');
    expect(read('.claude/settings.local.json')).toBe(settings([MINE]));
    expect(status()).toBe('');
  });

  it('deletes the AGENTS.md Otea made, and says so', async () => {
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    await otea('init', '--template', 'none', '--agents-md');
    expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(true);

    const result = await otea('uninstall', '--only', 'repos');

    expect(result.out).toContain("which held only Otea's block");
    expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
    expect(status()).toBe('');
  });

  it('never removes a pre-push hook that is not Otea’s, and says it left it', async () => {
    repo.write('.git/hooks/pre-push', '#!/bin/sh\necho mine\n');

    const result = await otea('uninstall', '--only', 'repos');

    expect(result.code).toBe(0);
    expect(read('.git/hooks/pre-push')).toBe('#!/bin/sh\necho mine\n');
    expect(result.out).toContain('Left the pre-push hook');
  });

  it('leaves another pre-push hook that runs Otea’s check, and says to take those lines out', async () => {
    repo.write(
      '.git/hooks/pre-push',
      '#!/bin/sh\notea check --gate push --branch x --repo || exit 1\n',
    );

    const result = await otea('uninstall', '--only', 'repos');

    expect(read('.git/hooks/pre-push')).toContain('otea check --gate push');
    expect(result.out).toContain("with Otea's check in it; take those lines out yourself");
  });

  it('takes out an outdated Otea hook too, whatever its version', async () => {
    repo.write('.git/hooks/pre-push', '#!/bin/sh\n# otea-hook: pre-push\nexit 0\n');

    await otea('uninstall', '--only', 'repos');

    expect(existsSync(hookFile())).toBe(false);
  });

  it('--dry-run says what it would do and changes nothing', async () => {
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    await otea('init', '--template', 'none', '--agents-md');
    await otea('hook', 'install', '--git');
    const before = [read('AGENTS.md'), read('.git/hooks/pre-push'), status()];

    const result = await otea('uninstall', '--dry-run');

    expect(result.code).toBe(0);
    expect(result.out).toContain('Dry run: nothing was changed.');
    expect(result.out).toContain('Would remove the pre-push hook');
    expect(result.out).toContain('Would remove');
    expect([read('AGENTS.md'), read('.git/hooks/pre-push'), status()]).toEqual(before);
  });

  it('is safe to run twice, and outside a repo it only looks at the machine', async () => {
    await otea('hook', 'install', '--git');
    expect((await otea('uninstall')).code).toBe(0);

    const again = await otea('uninstall');
    expect(again.code).toBe(0);
    expect(again.out).toContain(`Nothing of Otea's in ${repo.dir}`);

    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-nogit-')));
    try {
      const away = cliAt(outside, { OTEA_AGENT: 'claude' });
      const machine = await away('uninstall', '--only', 'machine');
      expect(machine.code).toBe(0);
      expect(machine.out).toContain('No otea serve is running');
      expect(machine.out).not.toContain('pre-push');
      const bad = await away('uninstall', '--only', 'everything');
      expect(bad.code).toBe(2);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  describe('connect and uninstall', () => {
    it('connect says it wrote the block, naming the file and the way back, and --json has a field', async () => {
      git('commit', '--quiet', '--allow-empty', '-m', 'one');
      const otea = cliAt(repo.dir);
      await otea('init', '--template', 'none');
      const file = join(repo.dir, 'AGENTS.md');

      const first = await otea('connect');
      expect(first.out).toContain(
        `${file} is the only file otea connect writes in your repo: the block between <!-- otea:begin --> and <!-- otea:end -->`,
      );
      expect(first.out).toContain('otea uninstall takes it out');

      const again = await otea('connect');
      expect(again.out).not.toContain('is the only file otea connect writes');
      expect(JSON.parse((await otea('connect', '--json')).out).agentsMd).toEqual({
        path: file,
        action: 'unchanged',
      });
    });

    // Otea was set up in several repos (the registry knows them): one uninstall cleans them all,
    // whatever folder it runs from, and tells the one that is gone.
    describe('in every repo the registry knows', () => {
      let second: ReturnType<typeof tempGitRepo>;
      let gone: ReturnType<typeof tempGitRepo>;
      let away: string;
      let elsewhere: Cli;
      const gitIn = (dir: string, ...args: string[]) =>
        execFileSync('git', [...AUTHOR, ...args], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });

      beforeEach(async () => {
        second = tempGitRepo();
        gone = tempGitRepo();
        away = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-away-')));
        elsewhere = cliAt(away);
        repo.write('AGENTS.md', '# First\n');
        git('add', '-A');
        git('commit', '--quiet', '-m', 'one');
        gitIn(second.dir, 'commit', '--quiet', '--allow-empty', '-m', 'one');
        gitIn(gone.dir, 'commit', '--quiet', '--allow-empty', '-m', 'one');
        for (const dir of [repo.dir, second.dir, gone.dir]) {
          const at = cliAt(dir);
          expect((await at('init', '--template', 'none')).code).toBe(0);
          expect((await at('connect')).code).toBe(0);
          expect((await at('hook', 'install', '--git')).code).toBe(0);
        }
        gone.remove();
      });

      afterEach(() => {
        second.remove();
        rmSync(away, { recursive: true, force: true });
      });

      it('lists every repo and file it would touch under --dry-run, and touches none', async () => {
        const before = [
          readFileSync(join(repo.dir, 'AGENTS.md'), 'utf8'),
          readFileSync(join(second.dir, 'AGENTS.md'), 'utf8'),
        ];

        const result = await elsewhere('uninstall', '--only', 'repos', '--dry-run');

        expect(result.code).toBe(0);
        for (const dir of [repo.dir, second.dir]) {
          expect(result.out).toContain(
            `Would remove the pre-push hook ${join(dir, '.git', 'hooks', 'pre-push')}`,
          );
        }
        expect(result.out).toContain(
          `Would remove Otea's block from ${join(repo.dir, 'AGENTS.md')}`,
        );
        expect(result.out).toContain(
          `Would remove ${join(second.dir, 'AGENTS.md')}, which held only Otea's block`,
        );
        expect(result.out).toContain(`Skipped ${gone.dir}: it no longer exists`);
        expect([
          readFileSync(join(repo.dir, 'AGENTS.md'), 'utf8'),
          readFileSync(join(second.dir, 'AGENTS.md'), 'utf8'),
        ]).toEqual(before);
        expect(existsSync(join(second.dir, '.git', 'hooks', 'pre-push'))).toBe(true);
      });

      it('takes the block and the hook out of each, from a folder that is no repo', async () => {
        const result = await elsewhere('uninstall', '--only', 'repos');

        expect(result.code).toBe(0);
        expect(result.out).toContain(`Skipped ${gone.dir}: it no longer exists`);
        expect(readFileSync(join(repo.dir, 'AGENTS.md'), 'utf8')).toBe('# First\n');
        expect(existsSync(join(second.dir, 'AGENTS.md'))).toBe(false);
        for (const dir of [repo.dir, second.dir]) {
          expect(existsSync(join(dir, '.git', 'hooks', 'pre-push'))).toBe(false);
          expect(gitIn(dir, 'status', '--porcelain')).toBe('');
        }
        expect(JSON.parse((await elsewhere('uninstall', '--json')).out).repos).toEqual(
          expect.arrayContaining([repo.dir, second.dir]),
        );
      });
    });
  });

  describe('--purge-data', () => {
    let home: string;
    let asked: string[];

    beforeEach(async () => {
      home = realpathSync.native(mkdtempSync(join(tmpdir(), 'otea-purge-')));
      vi.stubEnv('OTEA_HOME', home);
      git('commit', '--quiet', '--allow-empty', '-m', 'one');
      expect((await otea('init', '--template', 'none')).code).toBe(0);
      expect(existsSync(join(home, 'registry.db'))).toBe(true);
      asked = [];
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true, maxRetries: 10 });
    });

    const answering = (answer: string): Cli =>
      cliAt(repo.dir, { OTEA_AGENT: 'claude' }, undefined, undefined, async (question) => {
        asked.push(question);
        return answer;
      });

    it('keeps the data unless asked, and a no at the prompt keeps it too', async () => {
      expect((await otea('uninstall')).code).toBe(0);
      expect(existsSync(join(home, 'registry.db'))).toBe(true);

      const refused = await answering('no')('uninstall', '--purge-data');

      expect(refused.code).toBe(7);
      expect(asked[0]).toContain(home);
      expect(existsSync(join(home, 'registry.db'))).toBe(true);
      const unasked = await otea('uninstall', '--purge-data');
      expect(unasked.code).toBe(7);
      expect(existsSync(join(home, 'registry.db'))).toBe(true);
    });

    it('--dry-run only says it would delete it', async () => {
      const result = await otea('uninstall', '--purge-data', '--dry-run');

      expect(result.out).toContain(`Would delete the Otea data in ${home}`);
      expect(existsSync(join(home, 'registry.db'))).toBe(true);
    });

    it('deletes the Otea home after a yes, or --yes', async () => {
      const result = await answering('yes')('uninstall', '--purge-data');

      expect(result.code).toBe(0);
      expect(result.out).toContain(`Deleted the Otea data in ${home}`);
      expect(existsSync(home)).toBe(false);
      expect(status()).toBe('');

      mkdirSync(home);
      await otea('init', '--template', 'none');
      expect((await otea('uninstall', '--purge-data', '--yes')).code).toBe(0);
      expect(existsSync(join(home, 'registry.db'))).toBe(false);
    });

    it('never deletes a folder that holds the repo it runs in', async () => {
      vi.stubEnv('OTEA_HOME', repo.dir);
      mkdirSync(join(repo.dir, 'data'));

      const result = await otea('uninstall', '--purge-data', '--yes');

      expect(result.code).toBe(7);
      expect(existsSync(join(repo.dir, 'data'))).toBe(true);
    });
  });
});

describe('uninstall --only machine', () => {
  let repo: ReturnType<typeof tempGitRepo>;

  beforeEach(async () => {
    repo = tempGitRepo();
    expect((await spawnCli(repo.dir, 'init', '--local')).code).toBe(0);
  });

  afterEach(async () => {
    await spawnCli(repo.dir, 'serve', 'stop');
    repo.remove();
  });

  it('stops this home’s background server by its pid, and a dry run only says it would', async () => {
    const started = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    expect(started.code).toBe(0);
    const running = readServeFile(process.env.OTEA_HOME ?? '');
    expect(running).toBeDefined();
    const pid = running?.pid ?? 0;

    const dry = await spawnCli(repo.dir, 'uninstall', '--only', 'machine', '--dry-run');
    expect(dry.out).toContain(`Would stop otea serve (pid ${pid}`);
    expect(processAlive(pid)).toBe(true);

    const result = await spawnCli(repo.dir, 'uninstall', '--only', 'machine');

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Stopped otea serve (pid ${pid}`);
    await until(() => !processAlive(pid), 15_000);
    expect(readServeFile(process.env.OTEA_HOME ?? '')).toBeUndefined();
  });
});
