import { createHash } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A worker's harness is read from the process table by the command that starts its work, which on a
// busy machine may take seconds or fail. A lookup that failed (or timed out) is remembered for this
// long, per agent and folder, so the claims after it do not pay again: every command is its own
// process, so the memory is a file in the temp folder, never state of the process.
export const MISS_FOR_MS = 10 * 60_000;

const fileOf = (cwd: string, agent: string): string =>
  join(
    tmpdir(),
    `otea-harness-miss-${createHash('sha1').update(`${cwd}\0${agent}`).digest('hex').slice(0, 16)}`,
  );

// Whether a lookup for this agent in this folder failed within MISS_FOR_MS of `now`.
export function missedLately(cwd: string, agent: string, now: number = Date.now()): boolean {
  try {
    return now - statSync(fileOf(cwd, agent)).mtimeMs < MISS_FOR_MS;
  } catch {
    return false;
  }
}

export function noteMiss(cwd: string, agent: string): void {
  try {
    writeFileSync(fileOf(cwd, agent), '');
  } catch {
    // Nothing to remember it in: the next claim looks again.
  }
}
