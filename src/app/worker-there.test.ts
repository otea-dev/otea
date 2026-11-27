import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { cambios, tareasDeRepo } from '../core/board/testing.ts';
import type { Context } from './context.ts';
import { createItem, listItems } from './items.ts';
import { claimItem } from './leases.ts';
import { pendingOf } from './pending.ts';
import { listAgents, noteHarness, seeAgent } from './presence.ts';
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

  it('says stuck after a long silence, though a process still runs under the noted id', () => {
    noteHarness(ctx.db, ana.name, process.pid, at(0), true);

    // 40 minutes with no sign of it: the id may be another process's now.
    expect(stuck(40 * MIN)).toEqual([expect.objectContaining({ ref: id, by: ana.name })]);
  });
});
