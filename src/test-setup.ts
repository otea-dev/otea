import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';

// No test may touch the user's real ~/.otea. Each test file gets its own OTEA_HOME, which processes
// it spawns inherit, and the home folder is off limits: code that falls back to it throws.
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  const homedir = () => {
    throw new Error('Tests must not use the home folder; pass OTEA_HOME (a temp dir) in the env');
  };
  return { ...os, homedir, default: { ...os, homedir } };
});

const home = mkdtempSync(join(tmpdir(), 'otea-home-'));
process.env.OTEA_HOME = home;
// A process a test started and ended can hold the folder a moment longer on Windows (EPERM).
afterAll(() => rmSync(home, { recursive: true, force: true, maxRetries: 10 }));

// The language of what Otea makes with no desk to ask follows this computer's: a test that does not
// choose one gets Spanish, the owner's, whatever computer it runs on.
process.env.LC_ALL = 'es_ES.UTF-8';
