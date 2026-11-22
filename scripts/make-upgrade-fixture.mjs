// Regenerates src/app/fixtures/otea-0.1.0.db, the project database the published @otea/cli@0.1.0
// wrote: one project with two items on a board, one image attached, one answered topic.
//
//   node scripts/make-upgrade-fixture.mjs <scratch dir>
//
// The scratch dir (empty or new, outside the repo) holds the npm install and the temp OTEA_HOME.
// It never touches the real Otea home.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const scratch = process.argv[2] && resolve(process.argv[2]);
if (!scratch) throw new Error('usage: node scripts/make-upgrade-fixture.mjs <scratch dir>');
mkdirSync(scratch, { recursive: true });
if (readdirSync(scratch).length > 0) throw new Error(`${scratch} is not empty`);

const run = (cmd, args, options) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...options });

const prefix = join(scratch, 'npm');
// npm is a .cmd on Windows, which needs a shell; the quoted prefix keeps a path with spaces whole.
run('npm', ['install', '@otea/cli@0.1.0', '--prefix', `"${prefix}"`, '--silent'], {
  shell: process.platform === 'win32',
});
const bin = join(prefix, 'node_modules', '@otea', 'cli', 'bin', 'otea.mjs');

const home = join(scratch, 'home').replaceAll('\\', '/');
const repo = join(scratch, 'repo');
mkdirSync(repo);
const env = { ...process.env, OTEA_HOME: home };
const git = (...args) => run('git', args, { cwd: repo });
const otea = (...args) =>
  run(process.execPath, [bin, ...args, '--as', 'fixture'], { cwd: repo, env });

git('init', '--quiet');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
otea('init', '--template', 'todos');
otea('profile', '--model', 'unknown', '--effort', 'unknown', '--harness', 'claude-code');
otea(
  'create',
  '--collection',
  'To-dos',
  '--title',
  'First task',
  '--field',
  'What is needed=Fixture item one',
);
otea(
  'create',
  '--collection',
  'To-dos',
  '--title',
  'Second task',
  '--field',
  'What is needed=Fixture item two',
);
otea('claim', 'TOD-1');
// A 1x1 PNG.
const png = join(scratch, 'px.png');
writeFileSync(
  png,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
otea('attach', 'TOD-1', png, '--caption', 'fixture pixel');
otea('topic', 'on');
otea('topic', 'add', 'Which fixture question?', '--title', 'Fixture topic');
otea('topic', 'answer', 'TEM-1', '--summary', 'Fixture answer', '--full', 'Full fixture answer');

// One compact file: checkpoint the WAL into the database, then copy it out vacuumed.
const dataRoot = join(home, 'data');
const [projectDir] = readdirSync(dataRoot);
const source = new DatabaseSync(join(dataRoot, projectDir, 'otea.db'));
source.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const out = resolve(import.meta.dirname, '..', 'src', 'app', 'fixtures', 'otea-0.1.0.db');
mkdirSync(resolve(out, '..'), { recursive: true });
rmSync(out, { force: true });
source.prepare('VACUUM INTO ?').run(out);
source.close();
console.log(`wrote ${out}`);
