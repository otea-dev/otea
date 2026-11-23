import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// How many files a call of the otea command reads. Each is an open that a machine with an antivirus
// pays for (7 s for `otea --version` once, with ~250 modules in the graph), so the count is the
// budget: it does not wobble with how busy the machine is, as a time would.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_MAIN = join(ROOT, 'src', 'cli', 'main.ts');
const BUNDLE_DIR = join(ROOT, '.bundle-check', 'cli');
const BUNDLE_MAIN = join(BUNDLE_DIR, 'main.js');

// Node's loader hook, on its own thread, writes down every file module that loads.
const HOOK = `
import { appendFileSync } from 'node:fs';
export async function load(url, context, nextLoad) {
  if (!url.startsWith('node:')) appendFileSync(process.env.OTEA_LOADED_FILE, url + '\\n');
  return nextLoad(url, context);
}
`;
const REGISTER = `
import { register } from 'node:module';
register(new URL('./hook.mjs', import.meta.url));
`;

describe('what the otea command loads', () => {
  let scratch: string;
  let home: string;

  beforeAll(() => {
    // The real path: the loader names files by it, and a temp folder may be a link (macOS /var).
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'otea-startup-')));
    home = join(scratch, 'home');
    mkdirSync(home);
    writeFileSync(join(scratch, 'hook.mjs'), HOOK);
    writeFileSync(join(scratch, 'register.mjs'), REGISTER);
    const built = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'build-cli.mjs'), BUNDLE_DIR],
      { encoding: 'utf8' },
    );
    if (built.status !== 0) throw new Error(`the bundle did not build: ${built.stderr}`);
  }, 120_000);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
    rmSync(join(ROOT, '.bundle-check'), { recursive: true, force: true, maxRetries: 10 });
  });

  // The files the call loaded, and what it printed.
  function load(entry: string, ...args: string[]) {
    const list = join(scratch, `loaded-${Math.random().toString(36).slice(2)}.txt`);
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(join(scratch, 'register.mjs')).href, entry, ...args],
      {
        cwd: scratch,
        encoding: 'utf8',
        env: { ...process.env, OTEA_HOME: home, OTEA_LOADED_FILE: list, NODE_NO_WARNINGS: '1' },
      },
    );
    let loaded: string[] = [];
    try {
      // Not the two files that watch it.
      const mine = pathToFileURL(scratch).href;
      loaded = [...new Set(readFileSync(list, 'utf8').split('\n').filter(Boolean))].filter(
        (url) => !url.startsWith(mine),
      );
    } catch {}
    return { status, stdout, stderr, loaded };
  }

  const version = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
  ).version;

  it('is two files for --version in a checkout, and none of a package', () => {
    for (const flag of ['--version', '-v']) {
      const { status, stdout, loaded } = load(SOURCE_MAIN, flag);
      expect(status).toBe(0);
      expect(stdout).toBe(`${version}\n`);
      expect(loaded.length).toBeLessThanOrEqual(5);
      expect(loaded.filter((url) => url.includes('/node_modules/'))).toEqual([]);
    }
  });

  it('is five files of the bundle at most for --version, with no package from node_modules', () => {
    const { status, stdout, loaded } = load(BUNDLE_MAIN, '--version');
    expect(status).toBe(0);
    expect(stdout).toBe(`${version}\n`);
    expect(loaded.length).toBeLessThanOrEqual(5);
    expect(loaded.filter((url) => url.includes('/node_modules/'))).toEqual([]);
  });

  it('is a handful of bundle files for the commands, with no package from node_modules', () => {
    const { status, stdout, loaded } = load(BUNDLE_MAIN, '--help');
    expect(status).toBe(0);
    expect(stdout).toContain('Usage: otea <command> [options]');
    // The same call loads over a hundred modules from the source (a checkout, or the desktop app).
    expect(loaded.length).toBeLessThanOrEqual(20);
    expect(loaded.filter((url) => url.includes('/node_modules/'))).toEqual([]);
  });

  it('reads a project from the bundle as it does from the source', () => {
    const repo = join(scratch, 'repo');
    mkdirSync(repo);
    const run = (entry: string, ...args: string[]) =>
      spawnSync(process.execPath, [entry, ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, OTEA_HOME: home, NODE_NO_WARNINGS: '1' },
      });
    expect(spawnSync('git', ['init', '--quiet'], { cwd: repo }).status).toBe(0);
    expect(run(SOURCE_MAIN, 'init').status).toBe(0);
    const fromSource = run(SOURCE_MAIN, 'projects', 'current', '--json');
    const fromBundle = run(BUNDLE_MAIN, 'projects', 'current', '--json');
    expect(fromBundle.status).toBe(0);
    expect(fromBundle.stdout).toBe(fromSource.stdout);
    expect(fromBundle.stdout).toContain(repo.replaceAll('\\', '\\\\'));
  });
});
