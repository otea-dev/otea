import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postPersonMessage } from '../app/conversation.ts';
import { listAgents, processAlive } from '../app/presence.ts';
import { openProject, type Project } from '../app/project.ts';
import { secretaryStatus } from '../app/secretary.ts';
import { forgetHarness, selectListenerProcesses } from '../store/queries.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  removeOnceReleased,
  type TempRepo,
  tempGitRepo,
  until,
} from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

// F2 (field study 3): the person's desk told «conectado» for minutes after the secretary's process
// was killed. These tests run the secretary as a real process, as a harness does, and end it the
// way a crash does: no goodbye, no cleanup.
describe('the secretary seen offline once its process is gone', () => {
  let repo: TempRepo;
  let otea: Cli;
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir);
    const made = await otea('init', '--local', '--template', 'none');
    if (made.code !== 0) throw new Error(made.err);
    declareProfiles(repo.dir, 'sol', 'sol-worker');
    const declared = await otea('profile', '--role', 'secretary', '--as', 'sol');
    if (declared.code !== 0) throw new Error(declared.err);
  }, 60_000);

  // Each test is its own session of the secretary. A harness noted by the test before (here the
  // test's own worker, which runs on after the wait it started was killed, and which a fast
  // process table reads before the kill on Linux and macOS) is a live process a later wait that
  // wakes at once keeps as cached (it reads the table again only on a wait of five seconds or
  // more), so the next test would see it instead of its own. CI saw exactly that: «expected
  // <worker> to be <starter>».
  beforeEach(() => {
    lookAt((project) => {
      const noted = selectListenerProcesses(project.db).get('sol')?.harness ?? null;
      if (noted !== null) forgetHarness(project.db, 'sol', noted);
      // What an earlier test wrote to it is read and let go: a wait must not return at once for it
      // (a message read and not answered is owed, so it is also marked as returned enough).
      project.db
        .prepare(
          'UPDATE conversation_messages SET read_at = COALESCE(read_at, ?), owed_returns = 99',
        )
        .run(new Date().toISOString());
    });
  });

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    }
  });

  // Windows holds the folder of processes that just ended a moment longer.
  afterAll(() => removeOnceReleased(repo.dir), 30_000);

  // A real `otea wait --secretary` process, as the harness's background task runs it.
  const startWait = (): ChildProcess => {
    const child = spawn(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        MAIN,
        'wait',
        '--secretary',
        '--as',
        'sol',
        '--timeout',
        '10m',
      ],
      { cwd: repo.dir, env: { ...process.env }, stdio: 'ignore' },
    );
    children.push(child);
    return child;
  };

  // What the desk would read now. A look that meets the database mid-write by the processes under
  // test reads nothing this time: the next one does.
  const lookAt = <T>(read: (project: Project) => T): T | undefined => {
    try {
      const project = openProject(repo.dir);
      try {
        return read(project);
      } finally {
        project.db.close();
      }
    } catch {
      return undefined;
    }
  };

  const stateNow = () => lookAt((project) => secretaryStatus(project.db)?.state);

  const harnessNoted = () =>
    lookAt((project) => selectListenerProcesses(project.db).get('sol')?.harness);

  it('reads offline within seconds of its wait process being killed, long before the 30-minute hold', async () => {
    const child = startWait();
    await until(() => stateNow() === 'listening', 30_000);
    // A harness this one wait finds above it is only a candidate (G1), never trusted to say
    // «ended» alone, so this test depends on the wait process alone.
    const killedAt = Date.now();
    process.kill(child.pid as number);
    await until(() => stateNow() === 'offline', 8_000);

    expect(Date.now() - killedAt).toBeLessThan(8_000);
  }, 60_000);

  // The harness session is the secretary's real process: it runs `otea wait --secretary` in the
  // background, answers when it returns, and waits again. Killed between two waits, nothing of
  // Otea's runs, and it stayed «conectado» for the whole 30-minute hold.
  // A harness known by name (claude, codex...) is trusted at its first find (G1 review): `named`
  // puts «claude» in its command line, as the real one has; a process Otea does not know by name
  // (an intermediary may look like it) is the session only once two waits found it above them.
  it.each([
    { named: true, waits: 1 },
    { named: false, waits: 2 },
  ])(
    'reads offline within seconds of its harness being killed between two waits (named: $named)',
    async ({ named, waits }) => {
      // The harness is node running a script: Linux and macOS name it by its program (node, or its
      // thread), so what says it is claude is the script's name, as the real one's is.
      const starter = [
        "const { spawn } = require('node:child_process');",
        'const args = process.argv.slice(2);',
        "const run = (n) => { const c = spawn(process.execPath, args, { detached: true, stdio: 'ignore' }); console.log(c.pid); if (n > 1) c.on('exit', () => run(n - 1)); };",
        `run(${waits});`,
        'setTimeout(() => {}, 120_000);',
      ].join('\n');
      const dir = mkdtempSync(join(tmpdir(), 'otea-harness-'));
      const script = join(dir, named ? 'claude-code.js' : 'launcher.js');
      writeFileSync(script, starter);
      const harness = spawn(
        process.execPath,
        [
          script,
          '--disable-warning=ExperimentalWarning',
          MAIN,
          'wait',
          '--secretary',
          '--as',
          'sol',
          '--timeout',
          '10m',
        ],
        { cwd: repo.dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      children.push(harness);
      const pids: number[] = [];
      harness.stdout.setEncoding('utf8').on('data', (text: string) => {
        for (const line of text.split('\n')) if (line.trim() !== '') pids.push(Number(line));
      });
      await until(() => pids.length >= 1, 30_000);
      const wait = pids[0] as number;
      try {
        await until(() => stateNow() === 'listening', 30_000);
        // The person writes at once, before the wait has read the processes above it: it returns and
        // its process ends, the harness lives on, answering.
        const project = openProject(repo.dir);
        try {
          postPersonMessage(project, { text: 'is the PC on?' });
        } finally {
          project.db.close();
        }
        await until(() => !processAlive(wait), 30_000);
        if (waits > 1) {
          // The second wait starts at once and returns for the same unread message.
          await until(() => pids.length >= waits, 30_000);
          await until(() => !processAlive(pids[waits - 1] as number), 30_000);
        }
        // The harness is the session now.
        await until(() => harnessNoted() === harness.pid, 30_000);
        expect(stateNow()).toBe('connected');

        const killedAt = Date.now();
        process.kill(harness.pid as number);
        await until(() => stateNow() === 'offline', 8_000);

        expect(Date.now() - killedAt).toBeLessThan(8_000);
      } finally {
        for (const pid of pids) if (processAlive(pid)) process.kill(pid);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  // A harness runs its commands through a shell, which on Windows outlives it: killed in the
  // middle of its wait, the wait behind the shell still ends within seconds, and the desk reads the
  // secretary offline long before the wait's own timeout.
  it('reads offline within seconds of its harness being killed in the middle of its wait, behind a shell', async () => {
    const starter = [
      "const { spawn } = require('node:child_process');",
      'const line = JSON.parse(process.argv[2]);',
      "const win = process.platform === 'win32';",
      "const c = spawn(win ? 'cmd.exe' : 'sh', win ? ['/d', '/s', '/c', '\"' + line + '\"'] : ['-c', line], { detached: true, stdio: 'ignore', windowsVerbatimArguments: win });",
      'console.log(c.pid);',
      'setTimeout(() => {}, 120_000);',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'otea-harness-'));
    const script = join(dir, 'claude-code.js');
    writeFileSync(script, starter);
    const line = [process.execPath, '--disable-warning=ExperimentalWarning', MAIN, 'wait']
      .map((word) => `"${word}"`)
      .concat(['--secretary', '--as', 'sol', '--timeout', '10m'])
      .join(' ');
    const harness = spawn(process.execPath, [script, JSON.stringify(line)], {
      cwd: repo.dir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    children.push(harness);
    const pids: number[] = [];
    harness.stdout.setEncoding('utf8').on('data', (text: string) => {
      for (const each of text.split('\n')) if (each.trim() !== '') pids.push(Number(each));
    });
    try {
      await until(() => stateNow() === 'listening', 30_000);
      // The wait reads the processes after five seconds and notes the harness.
      await until(() => harnessNoted() === harness.pid, 30_000);
      const noted = lookAt((project) => selectListenerProcesses(project.db).get('sol'));
      expect(noted?.harness).toBe(harness.pid);

      const killedAt = Date.now();
      process.kill(harness.pid as number);
      await until(() => stateNow() === 'offline', 15_000);
      expect(Date.now() - killedAt).toBeLessThan(15_000);
    } finally {
      for (const pid of pids) if (processAlive(pid)) process.kill(pid);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  // U5 (the final study): the secretary's subagents (its worker and its refiner) wait from the same
  // harness, under their own names. After the harness was killed the desk still said «conectado»
  // 14 minutes later, with a change «working» and nobody alive. Everything under the harness is
  // gone with it: the secretary reads offline within seconds, and its worker is not there.
  it.each([{ named: true }, { named: false }])(
    'reads offline within seconds of its harness being killed while its subagent waits under it (named: $named)',
    async ({ named }) => {
      const starter = [
        "const { spawn } = require('node:child_process');",
        'const [main, ...rest] = process.argv.slice(2);',
        'const at = rest.indexOf("--");',
        'const first = rest.slice(0, at);',
        'const second = rest.slice(at + 1);',
        "const run = (args) => { const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...args], { detached: true, stdio: 'ignore' }); console.log(c.pid); return c; };",
        'const one = run(first);',
        "one.on('exit', () => { run(second); });",
        'setTimeout(() => {}, 120_000);',
      ].join('\n');
      const dir = mkdtempSync(join(tmpdir(), 'otea-harness-'));
      const script = join(dir, named ? 'claude-code.js' : 'launcher.js');
      writeFileSync(script, starter);
      const harness = spawn(
        process.execPath,
        [
          script,
          MAIN,
          'wait',
          '--secretary',
          '--as',
          'sol',
          '--timeout',
          '10m',
          '--',
          'wait',
          '--turn',
          'agent',
          '--unclaimed',
          '--as',
          'sol-worker',
          '--timeout',
          '10m',
        ],
        { cwd: repo.dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      children.push(harness);
      const pids: number[] = [];
      harness.stdout.setEncoding('utf8').on('data', (text: string) => {
        for (const line of text.split('\n')) if (line.trim() !== '') pids.push(Number(line));
      });
      await until(() => pids.length >= 1, 30_000);
      try {
        await until(() => stateNow() === 'listening', 30_000);
        const project = openProject(repo.dir);
        try {
          postPersonMessage(project, { text: 'is the PC on?' });
        } finally {
          project.db.close();
        }
        // The secretary's wait returns; the worker's starts and listens under the same harness.
        await until(() => pids.length >= 2, 30_000);
        // A harness Otea does not know by name is only a candidate for the secretary, whose wait
        // returned after one find: nothing but the worker's wait watches it from here on.
        if (named) await until(() => harnessNoted() === harness.pid, 30_000);
        const workerBeats = () =>
          lookAt((project) => selectListenerProcesses(project.db).get('sol-worker')?.waiter);
        await until(() => workerBeats() === pids[1], 30_000);
        // Let the worker's wait read the process table (it does so after five seconds).
        await new Promise((resolve) => setTimeout(resolve, 7_000));
        expect(stateNow()).toBe('connected');

        const killedAt = Date.now();
        process.kill(harness.pid as number);
        await until(() => stateNow() === 'offline', 12_000);
        expect(Date.now() - killedAt).toBeLessThan(12_000);
        // Its worker is gone with it: nobody is working.
        const workerLive = () =>
          lookAt(
            (project) => listAgents(project.db).find(({ name }) => name === 'sol-worker')?.live,
          );
        await until(() => workerLive() === false, 12_000);
      } finally {
        for (const pid of pids) if (processAlive(pid)) process.kill(pid);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
