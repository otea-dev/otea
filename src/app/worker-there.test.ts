import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { cambios, tareasDeRepo } from '../core/board/testing.ts';
import { clearLease } from '../store/queries.ts';
import type { Context } from './context.ts';
import { createItem, listItems } from './items.ts';
import { claimItem } from './leases.ts';
import { pendingOf } from './pending.ts';
import { keepLeasesOfAgentsThere, listAgents, noteHarness, seeAgent } from './presence.ts';
import { memoryContext, publishAs } from './testing.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const MIN = 60_000;
const at = (ms: number) => () => new Date(T0 + ms).toISOString();
const you = { kind: 'human' as const, name: 'fede' };
const ana = { kind: 'agent' as const, name: 'ana-cambios' };

// A process id that ended: nothing runs under it.
const deadPid = (): number => {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
};

// H2 (field study 4): a worker in a long step, with its harness running, was listed as stuck («no da
// señales») and counted in Te espera, in red, with nothing for the person to do. The session that
// runs is the sign it is there; «stuck» is for a harness that is gone, or a long silence.
describe('a worker whose harness runs is not stuck', () => {
  let ctx: Context;
  let id: string;

  beforeEach(() => {
    ctx = memoryContext();
    publishAs(ctx, tareasDeRepo(), 'brt', at(0));
    publishAs(ctx, cambios(), 'bcam', at(0));
    id = createItem(
      ctx,
      { collection: 'Cambios', title: 'A', fields: { fwhat: 'A' }, actor: you, channel: 'ui' },
      at(0),
    ).id;
    seeAgent(ctx.db, { agent: ana.name, channel: 'cli', call: true }, at(0));
    claimItem(ctx, { id, actor: ana }, at(0));
  });

  const stuck = (ms: number) =>
    pendingOf(ctx, at(ms), { blocks: false }).entries.filter(({ kind }) => kind === 'stuck');
  const status = (ms: number) =>
    listAgents(ctx.db, at(ms)).find(({ name }) => name === ana.name)?.status;

  it('keeps what it holds past its lease while its harness runs, and says working', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);

    // 20 minutes of one step with no otea call: the 15 minute lease ran out.
    expect(stuck(20 * MIN)).toEqual([]);
    const [item] = listItems(ctx, {}, at(20 * MIN));
    expect(item?.lease?.holder).toBe(ana.name);
    expect(item?.expiredLease).toBeUndefined();
    expect(status(20 * MIN)).toBe('working');
  });

  it('reads working, not «no signal», for a live harness quiet longer than the silent time', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);

    expect(status(10 * MIN)).toBe('working');
  });

  it('says stuck once its harness is gone', () => {
    noteHarness(ctx.db, ana.name, deadPid(), at(0), true);

    expect(stuck(20 * MIN)).toEqual([expect.objectContaining({ ref: id, by: ana.name })]);
    expect(status(20 * MIN)).toBe('away');
  });

  // The renewal reads the leases and the agents, then writes: a release in between (the person freed
  // the item) must win, never be undone by a renewal that took the lease again.
  it('never brings back a lease that was released between the read and the renewal', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);
    let freed = false;
    const processes = () => {
      if (!freed) {
        freed = true;
        clearLease(ctx.db, id);
      }
      return true;
    };

    keepLeasesOfAgentsThere(ctx.db, at(20 * MIN), processes);

    expect(freed).toBe(true);
    const [item] = listItems(ctx, {}, at(20 * MIN + 1));
    expect(item?.lease).toBeNull();
  });

  // A renewal cannot outlast the silence the desk tolerates: past THERE_FOR_MS of no sign the lease
  // is let go, so a hung session does not hold an item for ever.
  it('renews only up to the end of the tolerated silence', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);

    const [item] = listItems(ctx, {}, at(30 * MIN));

    expect(item?.lease?.holder).toBe(ana.name);
    expect(Date.parse(item?.lease?.expiresAt ?? '')).toBeLessThanOrEqual(T0 + 35 * MIN);
    // Past it, the lease runs out and the item is stuck.
    expect(stuck(36 * MIN)).toEqual([expect.objectContaining({ ref: id })]);
  });

  it('skips quietly on a database it cannot write', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);
    const dir = mkdtempSync(join(tmpdir(), 'otea-there-'));
    const file = join(dir, 'copy.db');
    ctx.db.exec(`VACUUM INTO '${file.replaceAll('\\', '/')}'`);
    const readOnly = new DatabaseSync(file, { readOnly: true });
    try {
      expect(() => keepLeasesOfAgentsThere(readOnly, at(20 * MIN))).not.toThrow();
    } finally {
      readOnly.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says stuck after a long silence, though a process still runs under the noted id', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);

    // 40 minutes with no sign of it: the id may be another process's now.
    expect(stuck(40 * MIN)).toEqual([expect.objectContaining({ ref: id, by: ana.name })]);
  });
});
