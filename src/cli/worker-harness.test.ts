import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAgents, processAlive } from '../app/presence.ts';
import { openProject, type Project } from '../app/project.ts';
import { selectListenerProcesses } from '../store/queries.ts';
import {
  cliAt,
  declareProfiles,
  presetCollection,
  type TempRepo,
  tempGitRepo,
  until,
} from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

// H2 (field study 4): a worker at a long step makes no otea call, and the desk read its item
// «atascado» and the worker «sin señal» while its session ran. The command that starts its work
// notes the harness session it runs under, as the secretary's wait does, so the session ending is
// what says it is gone.
describe('a worker is noted under the harness that ran its claim', () => {
  let repo: TempRepo;
  const children: ChildProcess[] = [];
  let scratch: string;

  beforeEach(async () => {
    repo = tempGitRepo();
    scratch = mkdtempSync(join(tmpdir(), 'otea-worker-harness-'));
    const person = cliAt(repo.dir);
    await person('init', '--local');
    declareProfiles(repo.dir, 'quill');
    presetCollection(repo.dir, 'tasks');
    await cliAt(repo.dir, { OTEA_AGENT: 'quill' })(
      'create',
      '--collection',
      'tasks',
      '--title',
      'First',
      '--description',
      'D',
    );
  }, 60_000);

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    }
    rmSync(scratch, { recursive: true, force: true });
    repo.remove();
  });

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

  it('reads gone once the harness it claimed under is gone, and not before', async () => {
    // The harness is node running a script named as a known one (claude-code.js): it runs `otea
    // claim` once, and lives on, as a session does while its worker is at a long step.
    const script = join(scratch, 'claude-code.js');
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process');",
        'spawn(process.execPath, process.argv.slice(2), { stdio: "ignore" });',
        'setTimeout(() => {}, 120_000);',
      ].join('\n'),
    );
    const harness = spawn(
      process.execPath,
      [script, '--disable-warning=ExperimentalWarning', MAIN, 'claim', 'TASKS-1', '--as', 'quill'],
      { cwd: repo.dir, env: { ...process.env }, stdio: 'ignore' },
    );
    children.push(harness);

    await until(
      () =>
        lookAt((project) => selectListenerProcesses(project.db).get('quill')?.harness) ===
        harness.pid,
      60_000,
    );
    const state = () =>
      lookAt((project) => listAgents(project.db).find(({ name }) => name === 'quill'));
    expect(state()).toMatchObject({ sessionEnded: false, there: true, status: 'working' });

    process.kill(harness.pid as number);
    await until(() => state()?.sessionEnded === true, 15_000);

    expect(state()).toMatchObject({ there: false, status: 'away' });
  }, 120_000);
});
