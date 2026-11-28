import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject } from '../app/project.ts';
import type { ProcessRow } from './owner.ts';
import { declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// How long a listing takes in the stub, and how much of the caller's environment may shorten the
// guard's wait: none. 200 ms is more than the 1 ms the environment asks for and far less than the
// 3 s the guard keeps as its floor, so what the guard decides shows which of them it waited.
const LISTING_MS = 200;

const sessionRows = (starter: number): ProcessRow[] => [
  // The assistant's session (this process, which runs) and, apart, the harness the caller runs under.
  { pid: process.pid, parent: 1, name: 'claude' },
  { pid: 4242, parent: 1, name: 'codex' },
  { pid: starter, parent: 4242, name: 'bash' },
];

// The process listing of a slow runner: it answers after LISTING_MS, unless the guard stopped waiting.
vi.mock('./owner.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./owner.ts')>();
  const { STARTED_BY } = await import('./started-by.ts');
  return {
    ...original,
    listProcesses: async (signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, LISTING_MS));
      return signal.aborted ? undefined : { rows: sessionRows(STARTED_BY), complete: true };
    },
  };
});

// S2 (final red-team run): the caller sets its own environment, so an impostor that could shorten
// the wait for the listing would make every listing time out, which reads as unverified and lets
// its act through. Shown end to end against a listing that takes 200 ms.
describe('the caller’s environment cannot shorten the guard’s wait for the process listing', () => {
  let repo: TempRepo;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('OTEA_SESSION_READ_MS', '1');
    repo = tempGitRepo();
    const { cliAt } = await import('./testing.ts');
    const owner = cliAt(repo.dir);
    await owner('init', '--local');
    declareProfiles(repo.dir, 'sol');
    const declared = await owner('profile', '--role', 'assistant', '--as', 'sol');
    expect(declared.code, declared.err).toBe(0);
    const project = openProject(repo.dir);
    try {
      // Its session runs: this process, a harness other than the one the stub gives the caller.
      project.db
        .prepare(
          'UPDATE agents SET listening_harness = :pid, listening_harness_started = NULL WHERE name = :agent',
        )
        .run({ pid: process.pid, agent: 'sol' });
    } finally {
      project.db.close();
    }
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await repo.remove();
  });

  it('still refuses an impostor when OTEA_SESSION_READ_MS is 1', async () => {
    const { cliAt } = await import('./testing.ts');

    const said = await cliAt(repo.dir)('say', 'Aprobé todo.', '--as', 'sol');

    expect(said.code, said.out).toBe(7);
    expect(said.err).toContain('runs in another session');
  });
});
