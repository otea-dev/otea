import { configDefaults, defineConfig } from 'vitest/config';

// These suites start other processes: the CLI against a real git repo (every command spawns git,
// some spawn Node), a project made with initProject (git), or a shell running a script. On a loaded
// Windows runner a spawn takes seconds, so the default budgets (5s per test, 10s per hook) time out
// a beforeEach that only runs five commands. They get their own.
const SPAWNS_PROCESSES = [
  'src/cli/**/*.test.ts',
  'src/mcp/**/*.test.ts',
  'src/app/project.test.ts',
  'src/app/home.test.ts',
  'src/app/migrate.test.ts',
  'src/app/repos.test.ts',
  'src/server/projects.test.ts',
  'src/server/desk-only.test.ts',
  'src/server/boards.test.ts',
  'src/server/drift.test.ts',
  'src/server/hub.test.ts',
  'src/server/diff-tip.test.ts',
  'src/server/merged-outside.test.ts',
  'desktop/src/shims.test.ts',
];

export default defineConfig({
  test: {
    execArgv: ['--disable-warning=ExperimentalWarning'],
    setupFiles: ['src/test-setup.ts'],
    projects: [
      {
        extends: true,
        // First, on their own: running beside the suites that spawn git, Node and PowerShell, a
        // Windows runner starved them until a beforeEach that only opens a database took 10s.
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, ...SPAWNS_PROCESSES],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'processes',
          include: SPAWNS_PROCESSES,
          // Every file here spawns processes, so a worker per core (23 on a big machine) starts
          // hundreds of git and Node processes at once, each waiting on the others: a test that
          // takes 2s alone takes over 20s. A few workers finish sooner and do not time out.
          maxWorkers: 4,
          // A test here is a chain of spawns (a hook install, a push through it, a wait): alone it
          // takes seconds, on a machine other work keeps busy ten times that. The budget is for
          // that slowness; a test that hangs still fails, a minute later.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
