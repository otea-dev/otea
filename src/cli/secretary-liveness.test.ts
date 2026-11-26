import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postPersonMessage } from '../app/conversation.ts';
import { processAlive } from '../app/presence.ts';
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
    declareProfiles(repo.dir, 'sol');
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
    // On Linux and macOS the process table reads at once, so this wait has noted its harness (the
    // test's own worker) before it is killed; on Windows it often has not. Either way is a state
    // the next test must not inherit.
    await until(() => typeof harnessNoted() === 'number', 30_000);

    const killedAt = Date.now();
    process.kill(child.pid as number);
    await until(() => stateNow() === 'offline', 8_000);

    expect(Date.now() - killedAt).toBeLessThan(8_000);
  }, 60_000);

  // The harness session is the secretary's real process: it runs `otea wait --secretary` in the
  // background, answers when it returns, and waits again. Killed between two waits, nothing of
  // Otea's runs, and it stayed «conectado» for the whole 30-minute hold.
  it('reads offline within seconds of its harness being killed between two waits', async () => {
    const starter = [
      "const c = require('node:child_process').spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' });",
      'c.unref();',
      'console.log(c.pid);',
      'setTimeout(() => {}, 120_000);',
    ].join(' ');
    const harness = spawn(
      process.execPath,
      [
        '-e',
        starter,
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
    const wait = await new Promise<number>((resolve) =>
      harness.stdout.setEncoding('utf8').once('data', (line: string) => resolve(Number(line))),
    );
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
      // The wait noted the harness session before it ended.
      expect(harnessNoted()).toBe(harness.pid);
      expect(stateNow()).toBe('connected');

      const killedAt = Date.now();
      process.kill(harness.pid as number);
      await until(() => stateNow() === 'offline', 8_000);

      expect(Date.now() - killedAt).toBeLessThan(8_000);
    } finally {
      if (processAlive(wait)) process.kill(wait);
    }
  }, 90_000);
});
