import { describe, expect, it } from 'vitest';
import { type ProcessProbe, processAlive } from './presence.ts';

// Field study 7: in a Linux container without an init, `otea serve stop` said «did not end» of a
// server that was down: an ended process nobody reaped (a zombie) still answers a signal.
describe('processAlive', () => {
  const here = process.pid;
  const probe = (over: Partial<ProcessProbe>): ProcessProbe => ({
    platform: 'linux',
    stat: () => undefined,
    ps: () => undefined,
    ...over,
  });

  // CI on PR #651: `chain.every(alive)` with alive = processAlive passed the array index as the
  // probe, and a timer threw «reading 'endsWith'» long after the test that set it.
  it('works as an array callback, where the second argument is an index', () => {
    expect([here].every(processAlive)).toBe(true);
    expect([here, 2 ** 22 + 12345].some(processAlive)).toBe(true);
    expect([2 ** 22 + 12345].filter(processAlive)).toEqual([]);
  });

  it('is true for a process that runs, and false for one that does not exist', () => {
    expect(processAlive(here)).toBe(true);
    expect(processAlive(2 ** 22 + 12345)).toBe(false);
  });

  it('counts a zombie as gone on Linux, from /proc/<pid>/stat, whatever its command is called', () => {
    for (const command of ['node', 'a b) Z c']) {
      const stat = `${here} (${command}) Z 1 ${here} ${here} 0 -1 4194560`;
      expect(processAlive(here, probe({ stat: () => stat }))).toBe(false);
    }
  });

  it('counts a process that sleeps or runs as alive on Linux, and one whose stat cannot be read', () => {
    expect(processAlive(here, probe({ stat: () => `${here} (node) S 1 2 3` }))).toBe(true);
    expect(processAlive(here, probe({ stat: () => `${here} (Z) R 1 2 3` }))).toBe(true);
    expect(processAlive(here, probe({}))).toBe(true);
  });

  it('counts a zombie as gone on macOS, from ps', () => {
    expect(processAlive(here, probe({ platform: 'darwin', ps: () => 'Z+\n' }))).toBe(false);
    expect(processAlive(here, probe({ platform: 'darwin', ps: () => 'Ss\n' }))).toBe(true);
    expect(processAlive(here, probe({ platform: 'darwin', ps: () => undefined }))).toBe(true);
  });

  it('asks nothing of the system on Windows, where there are no zombies', () => {
    const asked: string[] = [];
    const windows = probe({
      platform: 'win32',
      stat: () => void asked.push('stat'),
      ps: () => void asked.push('ps'),
    });
    expect(processAlive(here, windows)).toBe(true);
    expect(asked).toEqual([]);
  });
});
