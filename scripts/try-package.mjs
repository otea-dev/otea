// Tries the packed CLI the way a person gets it: installs the tarball into an empty folder (nothing
// of the checkout around it) and runs what the bundle must still find on disk and in itself: a
// project made (init), the presets and schemas read (board add --template todos), the MCP server
// answering over stdio, and the desk server's command. Exits non-zero, saying what failed.
// Run: node scripts/try-package.mjs <the .tgz, or the folder npm pack wrote it to>
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const given = resolve(process.argv[2] ?? '.');
const tarball = statSync(given).isDirectory()
  ? join(given, readdirSync(given).find((name) => /^otea-cli-.*\.tgz$/.test(name)) ?? 'none.tgz')
  : given;

const scratch = mkdtempSync(join(tmpdir(), 'otea-try-package-'));
const failures = [];
const check = (what, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(`${what}${detail ? `: ${detail}` : ''}`);
};

try {
  const prefix = join(scratch, 'prefix');
  mkdirSync(prefix);
  const install = spawnSync(
    'npm',
    ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  check('npm install of the tarball', install.status === 0, install.stderr);
  if (install.status !== 0) throw new Error('nothing to try without an install');

  const installed = join(prefix, 'node_modules', '@otea', 'cli');
  const bin = join(installed, 'bin', 'otea.mjs');
  const expected = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version;
  const home = join(scratch, 'home');
  const repo = join(scratch, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  const otea = (args, options = {}) =>
    spawnSync(process.execPath, [bin, ...args], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, OTEA_HOME: home, OTEA_NO_UPDATE_CHECK: '1' },
      ...options,
    });

  const version = otea(['--version']);
  check('--version', version.stdout.trim() === expected, `${version.stdout} ${version.stderr}`);

  check('git init', spawnSync('git', ['init', '--quiet'], { cwd: repo }).status === 0);
  const init = otea(['init']);
  check('init', init.status === 0, init.stderr);
  // Presets and the board schema come from the package's own folders.
  const board = otea(['board', 'add', 'Tasks', '--template', 'todos']);
  check(
    'board add --template todos',
    board.status === 0 && board.stdout.includes('Published board'),
    `${board.stdout} ${board.stderr}`,
  );
  const list = otea(['list', '--as', 'try-package']);
  check('list', list.status === 0, list.stderr);

  const hello = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'try-package', version: '0' },
    },
  });
  const mcp = otea(['mcp', '--as', 'try-package'], { input: `${hello}\n` });
  let info;
  try {
    info = JSON.parse(mcp.stdout.split('\n')[0] ?? '').result?.serverInfo;
  } catch {}
  check(
    'mcp answers initialize over stdio',
    info?.name === 'otea' && info?.version === expected,
    `${mcp.stdout.slice(0, 200)} ${mcp.stderr}`,
  );

  const serve = otea(['serve', '--help']);
  check(
    'serve --help',
    serve.status === 0 && serve.stdout.includes('otea serve'),
    `${serve.stdout} ${serve.stderr}`,
  );
} catch (error) {
  failures.push(String(error instanceof Error ? error.message : error));
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
}

if (failures.length > 0) {
  console.error(`The package does not work from a clean install:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
