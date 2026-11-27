import { describe, expect, it } from 'vitest';
import type { Noted } from '../app/session-bound.ts';
import type { ProcessRow } from './owner.ts';
import { callerIn, judgeCaller } from './session-guard.ts';

// Field study 5, V8: an orphan background process (no live parent, so no harness resolves from it)
// said as the secretary while the real one ran. While the noted session runs, a caller the table
// reads but cannot tie to it is not it, over the command line and over MCP.
const rows: ProcessRow[] = [
  { pid: 100, parent: 1, name: 'claude', started: 1_000_000 },
  { pid: 150, parent: 100, name: 'bash' },
  { pid: 160, parent: 150, name: 'node', started: 1_100_000 },
  // The orphan: its parent (999) is gone, so the table never reaches a harness from it.
  { pid: 200, parent: 999, name: 'node', started: 1_200_000 },
];

describe('the verdict on a caller read from the processes', () => {
  const cli: Noted = { kind: 'cli', pid: 100, started: 1_000_000 };
  const mcp: Noted = { kind: 'mcp', session: 300, launcher: 100 };

  it('takes a command under the noted harness for the session', () => {
    expect(judgeCaller(cli, callerIn(rows, 150)).verdict).toBe('bound');
    expect(judgeCaller(mcp, callerIn(rows, 150)).verdict).toBe('bound');
  });

  it('takes a command of another harness for another session', () => {
    const other = [...rows, { pid: 400, parent: 1, name: 'codex' }];
    expect(judgeCaller(cli, callerIn(other, 400)).verdict).toBe('other');
  });

  it('refuses a caller that no harness resolves from while the noted one runs, as a command or an MCP server', () => {
    expect(judgeCaller(cli, callerIn(rows, 999)).verdict).toBe('other');
    expect(judgeCaller(mcp, callerIn(rows, 999)).verdict).toBe('other');
  });

  it('lets a command through, unverified, only when nothing can be checked', () => {
    expect(judgeCaller(cli, undefined).verdict).toBe('unverified');
    // The harness an MCP server was started by is not listed: it cannot be resolved either.
    expect(
      judgeCaller({ kind: 'mcp', session: 300, launcher: 555 }, callerIn(rows, 150)).verdict,
    ).toBe('unverified');
  });

  it('lets a new session take over once the noted harness is gone', () => {
    const gone = rows.filter((row) => row.pid !== 100);
    expect(judgeCaller(cli, callerIn(gone, 999)).verdict).toBe('gone');
  });
});
