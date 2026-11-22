import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_BLOCK, removeAgentsMd, writeAgentsMd } from '../app/agents.ts';
import { oteaLauncher } from '../app/launcher.ts';
import { processAlive } from '../app/presence.ts';
import { installGitHook, isOteaOwnHook } from './hooks.ts';
import { run } from './run.ts';
import { readServeFile } from './serve-file.ts';
import { type Cli, cliAt, spawnCli, type TempRepo, tempGitRepo, until } from './testing.ts';
import { dataTargets, unsafeHome } from './uninstall.ts';

// The person's home folder, which no test may use: the guards are tried against one made here.
const own = vi.hoisted(() => ({ home: undefined as string | undefined }));
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  const homedir = () => {
    if (own.home === undefined) throw new Error('Tests must not use the home folder');
    return own.home;
  };
  return { ...os, homedir, default: { ...os, homedir } };
});

const AUTHOR = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

const temp = (prefix: string) => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

// Every file under a folder with its bytes, to tell whether anything in it changed.
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[path.slice(dir.length)] = readFileSync(path, 'base64');
    }
  };
  walk(dir);
  return files;
}

describe('AGENTS.md block removal', () => {
  let dir: string;
  const path = () => join(dir, 'AGENTS.md');
  const put = (text: string) => writeFileSync(path(), text);
  const text = () => readFileSync(path(), 'utf8');

  beforeEach(() => {
    dir = temp('otea-agents-');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('takes out exactly its block and leaves the person’s text before, after and between', () => {
    put(`# Mine\n\nbefore\n\n${AGENTS_BLOCK}\n\nafter\n`);

    expect(removeAgentsMd(dir).action).toBe('removed');

    expect(text()).toBe('# Mine\n\nbefore\n\nafter\n');
  });

  it('puts a file back as it was when the block was appended, and deletes one only Otea made', () => {
    put('# Mine\n\nrules\n');
    writeAgentsMd(dir);
    expect(removeAgentsMd(dir).action).toBe('removed');
    expect(text()).toBe('# Mine\n\nrules\n');

    rmSync(path());
    writeAgentsMd(dir);
    expect(removeAgentsMd(dir).action).toBe('deleted');
    expect(existsSync(path())).toBe(false);
  });

  it('removes a block in a CRLF file, keeping the file’s own line endings', () => {
    const crlf = (s: string) => s.replaceAll('\n', '\r\n');
    put(crlf(`# Mine\n\nbefore\n\n${AGENTS_BLOCK}\n\nafter\n`));
    expect(removeAgentsMd(dir).action).toBe('removed');
    expect(text()).toBe(crlf('# Mine\n\nbefore\n\nafter\n'));

    // A CRLF file Otea then appended its (LF) block to.
    put(crlf('# Mine\n\nrules\n'));
    writeAgentsMd(dir);
    expect(removeAgentsMd(dir).action).toBe('removed');
    expect(text()).toBe(crlf('# Mine\n\nrules\n'));
  });

  it.each([
    [
      'text of the person inside the markers',
      AGENTS_BLOCK.replace('## Otea', '## Otea\nmy own rule'),
    ],
    ['an older block with another text', AGENTS_BLOCK.replace('Follow', 'Always follow')],
    ['a begin marker twice', `${AGENTS_BLOCK}\n\n${AGENTS_BLOCK}`],
    ['a begin marker with no end', '<!-- otea:begin -->\n## Otea\nmine\n'],
    ['an end marker with no begin', 'mine\n<!-- otea:end -->\n'],
    ['the markers the wrong way round', '<!-- otea:end -->\nmine\n<!-- otea:begin -->\n'],
  ])('leaves the file whole and says why: %s', (_, content) => {
    const body = `# Mine\n\n${content}\n\nafter\n`;
    put(body);

    const result = removeAgentsMd(dir);

    expect(result.action).toBe('refused');
    expect(text()).toBe(body);
    // And a dry run says the same, writing nothing.
    expect(removeAgentsMd(dir, true).action).toBe('refused');
  });
});

describe('what uninstall leaves alone', () => {
  let repo: TempRepo;
  let otea: Cli;
  const git = (...args: string[]) =>
    execFileSync('git', [...AUTHOR, ...args], { cwd: repo.dir, stdio: 'pipe', encoding: 'utf8' });
  const hook = () => join(repo.dir, '.git', 'hooks', 'pre-push');
  const launcher = () => oteaLauncher(join(repo.dir, 'otea.mjs'), { execPath: 'node' });

  beforeEach(() => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir);
  });
  afterEach(() => repo.remove());

  it('knows the hook it writes, in every version, and nothing else', () => {
    installGitHook(repo.dir, launcher());
    const written = readFileSync(hook(), 'utf8');

    expect(isOteaOwnHook(written)).toBe(true);
    expect(isOteaOwnHook(written.replaceAll('\n', '\r\n'))).toBe(true);
    // The hook before the fail-closed one.
    expect(
      isOteaOwnHook(
        [
          '#!/bin/sh',
          '# otea-hook: pre-push',
          '# Written by otea hook install --git; otea hook remove --git removes it.',
          'while read -r local_ref local_sha remote_ref remote_sha; do',
          '  case "$remote_ref" in',
          '    refs/heads/*)',
          '      node "x.mjs" check --gate push --branch "${remote_ref#refs/heads/}" --repo < /dev/null',
          '      if [ $? -eq 1 ]; then exit 1; fi',
          '      ;;',
          '  esac',
          'done',
          'exit 0',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(isOteaOwnHook(`${written}npm test\n`)).toBe(false);
    expect(isOteaOwnHook(`npm test\n${written}`)).toBe(false);
    expect(isOteaOwnHook(written.replace('exit 1', 'exit 0'))).toBe(false);
    expect(isOteaOwnHook(written.replace('--repo', '--repo; rm -rf x'))).toBe(false);
  });

  it('deletes the hook Otea wrote and leaves one the person edited, saying so', async () => {
    installGitHook(repo.dir, launcher());
    const written = readFileSync(hook(), 'utf8');
    expect((await otea('uninstall', '--only', 'repos')).out).toContain('Removed the pre-push hook');
    expect(existsSync(hook())).toBe(false);

    for (const edited of [
      `${written}npm test\n`,
      `#!/bin/sh\nnpm run lint\n${written.slice(10)}`,
    ]) {
      writeFileSync(hook(), edited);

      const result = await otea('uninstall', '--only', 'repos');

      expect(result.code).toBe(0);
      expect(readFileSync(hook(), 'utf8')).toBe(edited);
      expect(result.out).toContain('Left the pre-push hook');
      expect(result.out).toContain('not what Otea writes');
    }
  });

  it('does not rewrite Claude settings with nothing of Otea’s, or call them removed', async () => {
    const settings = `${JSON.stringify(
      {
        permissions: { allow: ['Bash(ls)'] },
        hooks: { Stop: [{ hooks: [{ command: 'echo mine' }] }] },
      },
      null,
      2,
    )}\n`;
    repo.write('.claude/settings.local.json', settings);

    const result = await otea('uninstall', '--only', 'repos');

    expect(readFileSync(join(repo.dir, '.claude', 'settings.local.json'), 'utf8')).toBe(settings);
    expect(result.out).not.toContain('Removed the Otea hooks');
    expect(result.out).not.toContain('Would remove the Otea hooks');
  });

  it('cleans a repo and its linked worktree from the worktree, telling the shared hook once', async () => {
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    const tree = join(temp('otea-tree-'), 'wt');
    git('worktree', 'add', '--quiet', '-b', 'wt-branch', tree);
    try {
      const main = cliAt(repo.dir);
      const inTree = cliAt(tree);
      expect((await main('init', '--template', 'none')).code).toBe(0);
      expect((await main('connect')).code).toBe(0);
      expect((await inTree('connect')).code).toBe(0);
      expect((await main('hook', 'install', '--git')).code).toBe(0);
      expect(existsSync(join(tree, 'AGENTS.md'))).toBe(true);

      const result = await inTree('uninstall', '--only', 'repos');

      expect(result.code).toBe(0);
      expect(result.out.match(/Removed the pre-push hook/g)).toHaveLength(1);
      expect(existsSync(join(tree, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
      expect(existsSync(hook())).toBe(false);
      expect(git('status', '--porcelain')).toBe('');
    } finally {
      rmSync(join(tree, '..'), { recursive: true, force: true });
      git('worktree', 'prune');
    }
  });

  it('reports one folder it could not clean and goes on with the others', async () => {
    git('commit', '--quiet', '--allow-empty', '-m', 'one');
    const other = tempGitRepo();
    try {
      execFileSync('git', [...AUTHOR, 'commit', '--quiet', '--allow-empty', '-m', 'one'], {
        cwd: other.dir,
      });
      const there = cliAt(other.dir);
      expect((await there('init', '--template', 'none')).code).toBe(0);
      expect((await there('connect')).code).toBe(0);
      expect((await there('hook', 'install', '--git')).code).toBe(0);
      expect((await otea('init', '--template', 'none')).code).toBe(0);
      expect((await otea('hook', 'install', '--git')).code).toBe(0);
      // A file that cannot be read as the block's: a folder where AGENTS.md should be.
      rmSync(join(other.dir, 'AGENTS.md'));
      mkdirSync(join(other.dir, 'AGENTS.md'));

      const result = await there('uninstall', '--only', 'repos');

      expect(result.code).toBe(1);
      expect(result.out).toContain(`Could not clean ${join(other.dir, 'AGENTS.md')}`);
      expect(result.out).toContain(
        `Removed the pre-push hook ${join(other.dir, '.git', 'hooks', 'pre-push')}`,
      );
      expect(result.out).toContain(`Removed the pre-push hook ${hook()}`);
      expect(existsSync(hook())).toBe(false);
    } finally {
      other.remove();
    }
  });
});

describe('the data purge', () => {
  let home: string;
  let work: string;

  beforeEach(() => {
    home = temp('otea-purge-home-');
    work = temp('otea-purge-work-');
    own.home = undefined;
    writeFileSync(join(home, 'registry.db'), '');
  });
  afterEach(() => {
    own.home = undefined;
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  });

  it('never takes a filesystem root, the person’s home folder or a folder holding where it runs', () => {
    expect(unsafeHome(parse(home).root, work, undefined)).toBe('a filesystem root');
    expect(unsafeHome(home, work, home)).toBe('or holds your home folder');
    expect(unsafeHome(home, work, join(home, 'me'))).toBe('or holds your home folder');
    expect(unsafeHome(home, join(home, 'repo'), undefined)).toBe('or holds the folder you are in');
    expect(unsafeHome(home, home, undefined)).toBe('or holds the folder you are in');
    // A neighbour whose name starts the same is no container.
    expect(unsafeHome(home, `${home}-next`, undefined)).toBeUndefined();
    expect(unsafeHome(home, work, join(work, 'me'))).toBeUndefined();
  });

  it('asks for a registry as the mark of an Otea home, not a data folder or a serve record', () => {
    const bare = temp('otea-bare-');
    try {
      mkdirSync(join(bare, 'data'));
      writeFileSync(join(bare, 'serve.json'), '{}');
      writeFileSync(join(bare, 'ui-token'), 'x');

      expect(dataTargets(bare, work, false)).toEqual([]);
      expect(dataTargets(home, work, false)).toEqual([home]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('resolves a relative home against the folder the command runs in', async () => {
    const repo = tempGitRepo();
    try {
      mkdirSync(join(repo.dir, 'rel-home'));
      repo.write('rel-home/registry.db', '');
      repo.write('rel-home/keep-me-not.txt', 'x');
      const at = cliAt(repo.dir, { OTEA_HOME: 'rel-home' });

      const result = await at('uninstall', '--only', 'machine', '--purge-data', '--yes');

      expect(result.code).toBe(0);
      expect(existsSync(join(repo.dir, 'rel-home'))).toBe(false);
      expect(existsSync(repo.dir)).toBe(true);
    } finally {
      repo.remove();
    }
  });

  it('refuses the person’s own home folder, deleting nothing', async () => {
    own.home = home;
    vi.stubEnv('OTEA_HOME', home);
    const repo = tempGitRepo();
    try {
      const result = await cliAt(repo.dir)(
        'uninstall',
        '--only',
        'machine',
        '--purge-data',
        '--yes',
      );

      expect(result.code).toBe(7);
      expect(result.err).toContain('or holds your home folder');
      expect(existsSync(join(home, 'registry.db'))).toBe(true);
    } finally {
      repo.remove();
    }
  });

  it('compares real paths: a link to a folder that holds where it runs is refused', async () => {
    const link = join(work, 'link');
    try {
      symlinkSync(home, link, 'junction');
    } catch {
      return; // A computer that lets this user make no link has nothing to try.
    }
    const inside = join(home, 'repo');
    mkdirSync(inside);

    expect(() => dataTargets(link, inside, false)).toThrow('or holds the folder you are in');
    expect(existsSync(join(home, 'registry.db'))).toBe(true);
    // The same folder by the link is the folder: it is deleted as the one it is.
    expect(dataTargets(link, work, false)).toEqual([home]);
  });

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')(
    'compares case-insensitively where the file system does',
    () => {
      const inside = join(home, 'repo');
      mkdirSync(inside);

      expect(() => dataTargets(home.toUpperCase(), inside.toLowerCase(), false)).toThrow(
        'or holds the folder you are in',
      );
    },
  );
});

describe('uninstall writes nothing it was not asked to', () => {
  let home: string;
  let repo: TempRepo;
  let away: string;
  let asked: string[];

  beforeEach(async () => {
    home = temp('otea-quiet-home-');
    away = temp('otea-quiet-away-');
    vi.stubEnv('OTEA_HOME', home);
    repo = tempGitRepo();
    git(repo.dir, 'commit', '--quiet', '--allow-empty', '-m', 'one');
    const at = cliAt(repo.dir);
    expect((await at('init', '--template', 'none')).code).toBe(0);
    expect((await at('connect')).code).toBe(0);
    asked = [];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    repo.remove();
    rmSync(home, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  });

  const git = (dir: string, ...args: string[]) =>
    execFileSync('git', [...AUTHOR, ...args], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });

  // otea uninstall as a person at a terminal would run it, with a registry stand-in that is never
  // to be asked.
  async function uninstall(...argv: string[]) {
    let out = '';
    let err = '';
    const code = await run(['uninstall', ...argv], {
      cwd: away,
      env: { OTEA_HOME: home },
      signal: new AbortController().signal,
      openUrl: async () => {},
      stdout: { write: (chunk: string) => (out += chunk), isTTY: true },
      stderr: { write: (chunk: string) => (err += chunk) },
      fetch: async (url) => {
        asked.push(String(url));
        return Response.json({ version: '99.0.0' });
      },
    });
    return { code, out, err };
  }

  it('--dry-run leaves the Otea home byte for byte as it was, and asks no registry', async () => {
    const before = snapshot(home);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    for (const argv of [
      ['--dry-run'],
      ['--dry-run', '--purge-data'],
      ['--dry-run', '--only', 'repos'],
    ]) {
      const result = await uninstall(...argv);

      expect(result.code).toBe(0);
      expect(result.err).toBe('');
      expect(snapshot(home)).toEqual(before);
    }
    expect(asked).toEqual([]);
    expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(true);
  });

  it('--purge-data deletes the home and leaves no update check, or a new home, behind', async () => {
    const result = await uninstall('--purge-data', '--yes');

    expect(result.code).toBe(0);
    expect(result.out).toContain(`Deleted the Otea data in ${home}`);
    expect(asked).toEqual([]);
    // Give a late write the time it would take.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
  });
});

describe('--purge-data with a server running', () => {
  let home: string;
  let repo: TempRepo;

  beforeEach(async () => {
    home = temp('otea-live-home-');
    vi.stubEnv('OTEA_HOME', home);
    repo = tempGitRepo();
    expect((await spawnCli(repo.dir, 'init', '--template', 'none')).code).toBe(0);
  });
  afterEach(async () => {
    await spawnCli(repo.dir, 'serve', 'stop');
    vi.unstubAllEnvs();
    repo.remove();
    rmSync(home, { recursive: true, force: true });
  });

  it('stops the server first even when only the repos are asked for, then deletes the home', async () => {
    const started = await spawnCli(repo.dir, 'serve', 'start', '--no-open', '--port', '0');
    expect(started.code).toBe(0);
    const pid = readServeFile(home)?.pid ?? 0;
    expect(processAlive(pid)).toBe(true);

    const result = await spawnCli(
      repo.dir,
      'uninstall',
      '--only',
      'repos',
      '--purge-data',
      '--yes',
    );

    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(`Stopped otea serve (pid ${pid}`);
    expect(result.out).toContain(`Deleted the Otea data in ${home}`);
    await until(() => !processAlive(pid), 15_000);
    expect(existsSync(home)).toBe(false);
  });
});
