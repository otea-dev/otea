import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listConversation, postPersonMessage } from '../app/conversation.ts';
import { noteHarness, processAlive } from '../app/presence.ts';
import { openProject } from '../app/project.ts';
import {
  cliAt,
  declareProfiles,
  presetCollection,
  removeOnceReleased,
  type TempRepo,
  tempGitRepo,
  until,
} from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

// U8 (field study 4): `otea say "..." --as claude-sec` from any other process posted in Hablar
// labelled SECRETARIO, as the real one. The secretary is bound to the harness session noted for it:
// while that session runs, an act under its name from another harness is refused; once it is gone a
// new session takes over. A worker's name likewise cannot act on an item its live session leased.
describe('an agent name is bound to the harness session noted for it', () => {
  let repo: TempRepo;
  let scratch: string;
  const children: ChildProcess[] = [];
  // Each test names its own agents: an agent's home is the project it first worked in.
  let round = 0;
  let sol = '';
  let quill = '';

  beforeEach(async () => {
    round += 1;
    sol = `sol${round}`;
    quill = `quill${round}`;
    repo = tempGitRepo();
    scratch = mkdtempSync(join(tmpdir(), 'otea-session-bound-'));
    const owner = cliAt(repo.dir);
    await owner('init', '--local');
    declareProfiles(repo.dir, sol, quill);
    presetCollection(repo.dir, 'tasks');
    await owner('profile', '--role', 'secretary', '--as', sol);
    await cliAt(repo.dir, { OTEA_AGENT: quill })(
      'create',
      '--collection',
      'tasks',
      '--title',
      'First',
      '--description',
      'D',
    );
  }, 60_000);

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
    await removeOnceReleased(repo.dir);
  });

  // A harness session: a process named as a known one that runs one otea command once told to
  // (`go`), writes what it printed to a file and lives on, as a session does.
  const harness = (name: string, ...argv: string[]) => {
    const out = join(scratch, `${name}.json`);
    const goFile = join(scratch, `${name}.go`);
    const script = join(scratch, `${name}-claude-code.js`);
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process');",
        "const { existsSync, writeFileSync } = require('node:fs');",
        'const [out, goFile, main, ...argv] = process.argv.slice(2);',
        'const run = () => {',
        "  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });",
        "  let text = ''; let err = '';",
        "  child.stdout.on('data', (d) => { text += d; });",
        "  child.stderr.on('data', (d) => { err += d; });",
        "  child.on('close', (code) => writeFileSync(out, JSON.stringify({ code, out: text, err })));",
        '};',
        'const poll = setInterval(() => { if (existsSync(goFile)) { clearInterval(poll); run(); } }, 50);',
        'setTimeout(() => {}, 120_000);',
      ].join('\n'),
    );
    const child = spawn(process.execPath, [script, out, goFile, MAIN, ...argv], {
      cwd: repo.dir,
      env: { ...process.env },
      stdio: 'ignore',
    });
    children.push(child);
    const pid = child.pid as number;
    return {
      pid,
      // Noted as the session of `agent`: what its claim or wait leaves.
      boundTo: (agent: string) => {
        const project = openProject(repo.dir);
        try {
          noteHarness(project.db, agent, pid, undefined, true);
        } finally {
          project.db.close();
        }
        return pid;
      },
      kill: () => process.kill(pid),
      result: async () => {
        writeFileSync(goFile, '');
        await until(() => existsSync(out), 60_000);
        return JSON.parse(readFileSync(out, 'utf8')) as { code: number; out: string; err: string };
      },
    };
  };

  const spoken = () => {
    const project = openProject(repo.dir);
    try {
      return listConversation(project).messages.map(({ author, text }) => [author, text]);
    } finally {
      project.db.close();
    }
  };

  it('refuses a secretary act from another session, and lets the bound one speak', async () => {
    const real = harness('real', 'say', 'Hola.', '--as', sol);
    real.boundTo(sol);
    const stranger = harness('stranger', 'say', 'Aprobé todo.', '--as', sol);

    const refused = await stranger.result();
    const said = await real.result();

    expect(refused.code).toBe(7);
    expect(refused.err).toContain('runs in another session');
    expect(said.code, said.err).toBe(0);
    expect(spoken()).toEqual([['secretary', 'Hola.']]);
  }, 120_000);

  it('lets a new session take over once the bound one is gone', async () => {
    const old = harness('old', 'whoami', '--as', sol);
    old.boundTo(sol);
    old.kill();
    await until(() => !processAlive(old.pid), 15_000);

    const next = await harness('next', 'say', 'Estoy de vuelta.', '--as', sol).result();

    expect(next.code, next.err).toBe(0);
    expect(spoken()).toEqual([['secretary', 'Estoy de vuelta.']]);
  }, 120_000);

  it('refuses the secretary’s relay and wait from another session too', async () => {
    harness('bound', 'whoami', '--as', sol).boundTo(sol);
    const person = openProject(repo.dir);
    try {
      postPersonMessage(person, { text: 'tiralo', files: [] });
    } finally {
      person.db.close();
    }

    const relay = await harness(
      'r',
      'relay',
      'TASKS-1',
      'discarded',
      '--quote',
      'tiralo',
      '--from-message',
      '1',
      '--reason',
      'x',
      '--as',
      sol,
    ).result();
    const wait = await harness('w', 'wait', '--secretary', '--timeout', '1', '--as', sol).result();

    expect(relay.err).toContain('runs in another session');
    expect(wait.err).toContain('runs in another session');
  }, 120_000);

  it('refuses a worker name acting on an item its live session leased', async () => {
    const claim = await cliAt(repo.dir, { OTEA_AGENT: quill })('claim', 'TASKS-1');
    expect(claim.code, claim.err).toBe(0);
    harness('mine', 'whoami', '--as', quill).boundTo(quill);

    const stranger = await harness(
      'd',
      'handoff',
      'TASKS-1',
      '--note',
      'done',
      '--as',
      quill,
    ).result();

    expect(stranger.code).toBe(7);
    expect(stranger.err).toContain('leased by a session of quill');
    const shown = await cliAt(repo.dir, { OTEA_AGENT: quill })('show', 'TASKS-1', '--json');
    expect(JSON.parse(shown.out).lease.holder).toBe(quill);
  }, 120_000);
});
