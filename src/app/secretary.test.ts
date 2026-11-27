import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LISTEN_WINDOW_MS } from '../core/agent-status.ts';
import { UNHEARD_GRACE_MS } from '../core/notify/signals.ts';
import { selectStretches } from '../store/secretary.ts';
import { BETWEEN_ITEMS_MS } from './board-workers.ts';
import { addCollection } from './collections.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { claimItem, releaseItem } from './leases.ts';
import {
  endProcess,
  endWaiter,
  endWaiting,
  forgetGoneHarness,
  listAgents,
  noteHarness,
  renewLeases,
  seeAgent,
  waitBeat,
} from './presence.ts';
import {
  ackSecretaryReturns,
  addSecretarySource,
  declareSecretary,
  emitSecretarySignal,
  requireSecretary,
  SECRETARY_HELD_MS,
  secretaryName,
  secretaryStatus,
  secretaryWake,
  startSecretaryWait,
} from './secretary.ts';
import { memoryContext } from './testing.ts';
import { unheardOf } from './unheard.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const stamp = (ms: number) => () => new Date(ms).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();

const running = () => true;
const gone = () => false;

describe('the secretary', () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = memoryContext();
    addCollection(ctx, { name: 'tasks' });
  });

  afterEach(() => ctx.db.close());

  // An agent in otea wait: heard, and noted waiting, through a process of its own.
  const wait = (agent: string, ms: number, waiter = 101) =>
    waitBeat(ctx.db, { agent, channel: 'cli', waiter }, stamp(ms)).run();

  const newTask = (ms: number) =>
    createItem(
      ctx,
      {
        collection: 'tasks',
        title: 'Write the docs',
        fields: { description: 'Now' },
        actor: { kind: 'agent', name: 'claude' },
      },
      stamp(ms),
    ).id;

  describe('one per project', () => {
    it('refuses a second secretary while the first is connected', () => {
      wait('sol', T0);
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('luna', T0, 202);

      expect(() => declareSecretary(ctx.db, 'luna', stamp(T0), running)).toThrow(
        expect.objectContaining({ code: 'secretary_taken' }),
      );
      expect(secretaryName(ctx.db)).toBe('sol');
    });

    it('lets a new session take over from a secretary whose session ended', () => {
      wait('sol', T0);
      declareSecretary(ctx.db, 'sol', stamp(T0), running);

      const later = T0 + LISTEN_WINDOW_MS + 60_000;
      const declared = declareSecretary(ctx.db, 'luna', stamp(later), gone);

      expect(declared).toEqual({ agent: 'luna', role: 'secretary', replaced: 'sol' });
      expect(secretaryName(ctx.db)).toBe('luna');
      const roles = listAgents(ctx.db, stamp(later), gone).map(({ name, role }) => [name, role]);
      expect(roles).toContainEqual(['sol', null]);
    });

    // A command-line secretary has no process once its wait returned: it works for minutes before it
    // waits again, and is neither offline nor replaceable for that.
    describe('right after its wait returned', () => {
      beforeEach(() => {
        wait('sol', T0);
        declareSecretary(ctx.db, 'sol', stamp(T0), running);
        endWaiting(ctx.db, 'sol', iso(T0));
        endWaiter(ctx.db, 'sol', 101);
        endProcess(ctx.db, 101);
      });

      it('holds the role past the listening window', () => {
        const later = T0 + LISTEN_WINDOW_MS + 60_000;
        wait('luna', later, 202);

        expect(() => declareSecretary(ctx.db, 'luna', stamp(later), gone)).toThrow(
          expect.objectContaining({ code: 'secretary_taken' }),
        );
        expect(secretaryName(ctx.db)).toBe('sol');
      });

      it('reads as connected, not offline, past the listening window', () => {
        const later = T0 + LISTEN_WINDOW_MS + 60_000;

        expect(secretaryStatus(ctx.db, stamp(later), gone)).toMatchObject({
          name: 'sol',
          state: 'connected',
          since: null,
        });
      });

      it('is replaced, and reads offline, once it has not been heard for the held window', () => {
        const later = T0 + SECRETARY_HELD_MS + 1000;

        expect(secretaryStatus(ctx.db, stamp(later), gone)).toMatchObject({
          state: 'offline',
          since: iso(T0),
        });
        expect(declareSecretary(ctx.db, 'luna', stamp(later), gone).replaced).toBe('sol');
      });

      // G1: harnessOf may pick an intermediary that lives one command (bwrap, docker exec, ssh):
      // trusting it at once would read the secretary offline between two waits.
      describe('with a process seen by one wait only', () => {
        const only = (pid: number) => (other: number) => other === pid;

        it('is no proof that its session ended: it may be an intermediary that ended with its command', () => {
          noteHarness(ctx.db, 'sol', 4242, stamp(T0));

          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)?.state).toBe('connected');
        });

        it('is the session once the next wait found the same process above it', () => {
          noteHarness(ctx.db, 'sol', 4242, stamp(T0));
          noteHarness(ctx.db, 'sol', 4242, stamp(T0 + 1000));

          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)?.state).toBe('offline');
          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), only(4242))?.state).toBe('connected');
        });

        it('is the session at once when it is a harness known by name, so a killed session reads offline fast', () => {
          noteHarness(ctx.db, 'sol', 4242, stamp(T0), true);

          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)?.state).toBe('offline');
        });

        it('stays unproven while every wait finds another process', () => {
          noteHarness(ctx.db, 'sol', 4242, stamp(T0));
          noteHarness(ctx.db, 'sol', 4243, stamp(T0 + 1000));

          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)?.state).toBe('connected');
        });
      });

      // Its harness session (noted by its wait) is the one process left to ask about.
      describe('with the harness session it runs under noted', () => {
        const harness = 4242;
        // Noted by two waits: the same process above both (see above).
        beforeEach(() => {
          noteHarness(ctx.db, 'sol', harness, stamp(T0));
          noteHarness(ctx.db, 'sol', harness, stamp(T0));
        });
        const only = (pid: number) => (other: number) => other === pid;

        // A harness id that runs may be another process's by now (Windows hands ids out within
        // seconds): it means the session only while something of the secretary noted it lately.
        it('is no session once its id runs but nothing of the secretary noted it for a long while', () => {
          const later = T0 + 40 * 60_000;
          seeAgent(ctx.db, { agent: 'sol', channel: 'cli', call: true }, stamp(later));

          expect(secretaryStatus(ctx.db, stamp(later), only(harness))?.state).toBe('offline');
        });

        it('is kept as the session by what the secretary does: a command notes it again', () => {
          const later = T0 + 40 * 60_000;
          seeAgent(ctx.db, { agent: 'sol', channel: 'cli', call: true }, stamp(later - 1000));
          forgetGoneHarness(ctx.db, 'sol', only(harness), stamp(later - 1000));

          expect(secretaryStatus(ctx.db, stamp(later), only(harness))?.state).toBe('connected');
        });

        it('never overrides a listener of it that runs', () => {
          wait('sol', T0 + 1000, 101);

          // The wait (101) runs; the harness id does not.
          expect(secretaryStatus(ctx.db, stamp(T0 + 2000), only(101))?.state).toBe('listening');
        });

        it('holds while that session lives', () => {
          const later = T0 + 10 * 60_000;

          expect(secretaryStatus(ctx.db, stamp(later), only(harness))).toMatchObject({
            state: 'connected',
          });
        });

        it('reads offline at once when that session is gone, with no window to wait for', () => {
          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)).toMatchObject({
            state: 'offline',
            since: iso(T0),
          });
          expect(declareSecretary(ctx.db, 'luna', stamp(T0 + 3000), gone).replaced).toBe('sol');
        });

        it('stops holding it after the held window even while the session lives', () => {
          const later = T0 + SECRETARY_HELD_MS + 1000;

          expect(secretaryStatus(ctx.db, stamp(later), only(harness))?.state).toBe('offline');
        });

        it('is a new session once it speaks again after that one is gone', () => {
          forgetGoneHarness(ctx.db, 'sol', gone);

          expect(secretaryStatus(ctx.db, stamp(T0 + 3000), gone)).toMatchObject({
            state: 'connected',
          });
        });
      });
    });

    it('is idempotent for the same agent', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      expect(declareSecretary(ctx.db, 'sol', stamp(T0), running).replaced).toBeNull();
    });

    it('lets only the secretary wait as the secretary', () => {
      expect(() => requireSecretary(ctx.db, 'sol')).toThrow(/has none yet/);
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      expect(() => requireSecretary(ctx.db, 'luna')).toThrow(/sol is/);
      expect(() => requireSecretary(ctx.db, 'sol')).not.toThrow();
    });
  });

  describe('the boards do not count it as listening', () => {
    it('stays connected, not listening, while it waits, and still reads as attending', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('sol', T0);

      const sol = listAgents(ctx.db, stamp(T0), running).find(({ name }) => name === 'sol');
      expect(sol).toMatchObject({ role: 'secretary', attending: true, waiting: false });
      expect(sol?.status).toBe('connected');
    });

    it('leaves an item unheard while only the secretary waits, and heard once a worker does', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      const id = newTask(T0);
      const item = { turn: 'agent' as const, lease: null };
      wait('sol', T0);

      const agents = () => listAgents(ctx.db, stamp(T0), running);
      expect(unheardOf(item, agents(), new Date(T0).toISOString(), false)).toBe(true);

      wait('worker', T0, 202);
      expect(unheardOf(item, agents(), new Date(T0).toISOString(), false)).toBe(false);
      expect(id).toBe('TASKS-1');
    });
  });

  describe('its wait wakes on', () => {
    // One wait, begun `began` ms after the start: what each of its looks finds, `ms` after it.
    const newWait = (began = 0) => {
      const wait = startSecretaryWait(stamp(T0 + began));
      return (ms: number) => secretaryWake(ctx, wait, stamp(T0 + ms), running);
    };

    it('a message from the person, a Bandeja capture and an escalated question, oldest first, once each', () => {
      emitSecretarySignal(ctx.db, { kind: 'person_message', ref: 'm-1', text: 'hola' }, stamp(T0));
      emitSecretarySignal(ctx.db, { kind: 'bandeja_item', ref: 'b-1' }, stamp(T0 + 1));
      emitSecretarySignal(ctx.db, { kind: 'escalation', ref: 'TASKS-4' }, stamp(T0 + 2));
      const look = newWait();

      expect(look(10)).toMatchObject({ kind: 'person_message', ref: 'm-1' });
      expect(look(10)).toMatchObject({ kind: 'bandeja_item', ref: 'b-1' });
      expect(look(10)).toMatchObject({ kind: 'escalation', ref: 'TASKS-4' });
      expect(look(10)).toBeUndefined();
    });

    it('refuses a signal of a kind it does not know', () => {
      expect(() => emitSecretarySignal(ctx.db, { kind: 'gossip' as never }, stamp(T0))).toThrow(
        /Unknown secretary signal/,
      );
    });

    it('what a source derived from the state of its own records says is pending', () => {
      let pending = true;
      const remove = addSecretarySource(() =>
        pending ? { kind: 'person_message', ref: 'm-9' } : undefined,
      );
      try {
        const look = newWait();
        expect(look(0)).toMatchObject({ kind: 'person_message', ref: 'm-9' });
        // Still pending on the next look: nothing was lost with a signal.
        expect(look(10)).toMatchObject({ kind: 'person_message', ref: 'm-9' });
        pending = false;
        expect(look(20)).toBeUndefined();
      } finally {
        remove();
      }
    });

    describe('a signal returned to a wait that was killed', () => {
      beforeEach(() => {
        declareSecretary(ctx.db, 'sol', stamp(T0), running);
        emitSecretarySignal(ctx.db, { kind: 'person_message', ref: 'm-1' }, stamp(T0));
      });

      it('is returned again to the next wait, until the secretary acts', () => {
        expect(newWait(0)(10)).toMatchObject({ kind: 'person_message', ref: 'm-1' });

        expect(newWait(1000)(1010)).toMatchObject({ kind: 'person_message', ref: 'm-1' });
      });

      it('is not returned again once the secretary acted', () => {
        expect(newWait(0)(10)).toMatchObject({ ref: 'm-1' });
        ackSecretaryReturns(ctx.db, 'sol', stamp(T0 + 500));

        expect(newWait(1000)(1010)).toBeUndefined();
      });

      it('is returned again once, never more, and is not an ack from another agent', () => {
        expect(newWait(0)(10)).toMatchObject({ ref: 'm-1' });
        ackSecretaryReturns(ctx.db, 'luna', stamp(T0 + 500));
        expect(newWait(1000)(1010)).toMatchObject({ ref: 'm-1' });

        expect(newWait(2000)(2010)).toBeUndefined();
      });

      it('is not returned to a wait that began before it was returned, which is one of its own', () => {
        const first = newWait(0);
        const second = newWait(0);

        expect(first(10)).toMatchObject({ ref: 'm-1' });
        expect(second(20)).toBeUndefined();
      });
    });

    it('goes to one of two waits that look at the same time', () => {
      emitSecretarySignal(ctx.db, { kind: 'bandeja_item', ref: 'b-1' }, stamp(T0));
      const first = newWait(0);
      const second = newWait(0);

      const found = [first(10), second(10)].filter((wake) => wake !== undefined);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ kind: 'bandeja_item', ref: 'b-1' });
    });

    describe('a board with work and nobody listening', () => {
      it('once it stayed so for the grace, and told once for the stretch', () => {
        const id = newTask(T0);
        const look = newWait();
        // The grace counts from the first look.
        expect(look(0)).toBeUndefined();
        expect(look(UNHEARD_GRACE_MS - 6000)).toBeUndefined();

        expect(look(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'unheard', items: [id] });
        expect(look(UNHEARD_GRACE_MS + 5000)).toBeUndefined();
      });

      it('with the grace held across waits that end and begin again', () => {
        const id = newTask(T0);
        newWait(0)(0);

        expect(newWait(30_000)(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'unheard', items: [id] });
      });

      it('told again to a later wait if the secretary did not act, but not once it did', () => {
        declareSecretary(ctx.db, 'sol', stamp(T0), running);
        const id = newTask(T0);
        newWait(0)(0);
        expect(newWait(0)(UNHEARD_GRACE_MS)).toMatchObject({ items: [id] });

        expect(newWait(UNHEARD_GRACE_MS + 1000)(UNHEARD_GRACE_MS + 6000)).toMatchObject({
          items: [id],
        });
        ackSecretaryReturns(ctx.db, 'sol', stamp(T0 + UNHEARD_GRACE_MS + 7000));
        expect(newWait(UNHEARD_GRACE_MS + 8000)(UNHEARD_GRACE_MS + 13_000)).toBeUndefined();
      });

      it('not for work a worker is listening for, which ends its stretch', () => {
        newTask(T0);
        const look = newWait();
        look(0);
        wait('worker', T0 + UNHEARD_GRACE_MS - 1000, 202);

        expect(look(UNHEARD_GRACE_MS)).toBeUndefined();
        expect(selectStretches(ctx.db).size).toBe(0);
      });

      // F2 (field study 3): «nobody is listening» was told while a worker the secretary had
      // launched was busy, and the secretary launched a second one that did the same item.
      describe('with a worker of the board at work', () => {
        const at = (ms: number) => stamp(T0 + ms);
        const worker = { kind: 'agent' as const, name: 'ana-tasks' };

        it('not while it holds another item of the board, however long its step runs', () => {
          const busy = newTask(T0);
          newTask(T0);
          const look = newWait();
          claimItem(ctx, { id: busy, actor: worker }, at(0));
          look(0);
          // A step of several minutes with no otea call: working, never «nobody».
          const quiet = UNHEARD_GRACE_MS + 60_000;
          renewLeases(ctx.db, 'ana-tasks', at(quiet - 30_000));
          seeAgent(ctx.db, { agent: 'ana-tasks', channel: 'cli', call: true }, at(0));

          expect(look(UNHEARD_GRACE_MS)).toBeUndefined();
          expect(look(quiet)).toBeUndefined();
        });

        it('not while it is between two items, just after it handed one off or let it go', () => {
          const first = newTask(T0);
          newTask(T0);
          const look = newWait();
          claimItem(ctx, { id: first, actor: worker }, at(0));
          releaseItem(ctx, { id: first, actor: worker }, at(60_000));
          const sign = () =>
            seeAgent(
              ctx.db,
              { agent: 'ana-tasks', channel: 'cli', call: true },
              at(UNHEARD_GRACE_MS + 30_000),
            );
          look(0);
          sign();

          expect(look(UNHEARD_GRACE_MS + 30_000)).toBeUndefined();
        });

        it('but told once it went quiet: only a worker that is still there is waited for', () => {
          const first = newTask(T0);
          newTask(T0);
          const look = newWait();
          claimItem(ctx, { id: first, actor: worker }, at(0));
          seeAgent(ctx.db, { agent: 'ana-tasks', channel: 'cli', call: true }, at(1000));
          releaseItem(ctx, { id: first, actor: worker }, at(1000));
          // Looked at every half minute for a quarter of an hour; the worker never comes back.
          let told: number | undefined;
          for (let ms = 0; ms <= 15 * 60_000 && told === undefined; ms += 30_000) {
            if (look(ms)?.kind === 'unheard') told = ms;
          }

          // Not while it was there (its last call, and the window after it), and then it is told.
          expect(told).toBeGreaterThan(LISTEN_WINDOW_MS);
          expect(told).toBeLessThanOrEqual(BETWEEN_ITEMS_MS + UNHEARD_GRACE_MS);
        });
      });

      it('begins again when a listener came and went while nobody looked', () => {
        const id = newTask(T0);
        newWait(0)(0);
        // A worker listened for a moment in between, and its window has run out by the next look.
        wait('worker', T0 + 30_000, 202);
        const later = T0 + 30_000 + LISTEN_WINDOW_MS + 1000;
        const look = newWait(later - T0 - 1000);

        expect(look(later - T0)).toBeUndefined();
        // The stretch began at that look, so the grace counts from it.
        expect(look(later - T0 + UNHEARD_GRACE_MS)).toMatchObject({ items: [id] });
      });

      it('begins again when nobody looked for a long while', () => {
        const id = newTask(T0);
        newWait(0)(0);
        const long = 10 * 60_000;
        const look = newWait(long);

        expect(look(long)).toBeUndefined();
        expect(look(long + UNHEARD_GRACE_MS)).toMatchObject({ items: [id] });
      });

      it('while only the secretary itself waits', () => {
        declareSecretary(ctx.db, 'sol', stamp(T0), running);
        const id = newTask(T0);
        wait('sol', T0);
        const look = newWait();
        look(0);
        wait('sol', T0 + UNHEARD_GRACE_MS);

        expect(look(UNHEARD_GRACE_MS)).toMatchObject({ items: [id] });
      });

      it('is looked at every few seconds, not on every look', () => {
        newTask(T0);
        const look = newWait();
        look(0);
        newTask(T0 + 1000);

        look(1000);
        expect(selectStretches(ctx.db).size).toBe(1);
        look(5000);
        expect(selectStretches(ctx.db).size).toBe(2);
      });
    });

    it('a signal first, and the unheard board after it', () => {
      const id = newTask(T0);
      const look = newWait();
      look(0);
      emitSecretarySignal(ctx.db, { kind: 'person_message', ref: 'm-2' }, stamp(T0));

      expect(look(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'person_message' });
      expect(look(UNHEARD_GRACE_MS + 5000)).toMatchObject({ kind: 'unheard', items: [id] });
    });
  });

  describe('its status', () => {
    it('is none until a secretary is declared', () => {
      expect(secretaryStatus(ctx.db, stamp(T0), running)).toBeUndefined();
    });

    it('says listening in its wait, connected out of it, and what waits for it', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('sol', T0);
      emitSecretarySignal(ctx.db, { kind: 'person_message' }, stamp(T0));

      expect(secretaryStatus(ctx.db, stamp(T0), running)).toEqual({
        name: 'sol',
        state: 'listening',
        since: null,
        pending: 1,
      });
    });

    // T1a: its wait beats more often than a sighting is written: offline since its last beat, not
    // since the sighting before it (up to a wait's length earlier).
    it('says offline since the last beat of its wait', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('sol', T0);
      wait('sol', T0 + 20_000);

      expect(secretaryStatus(ctx.db, stamp(T0 + 21_000), gone)?.since).toBe(iso(T0 + 20_000));
    });

    it('says offline since the last time it was heard, once its session ended', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('sol', T0);

      // Its wait process is gone: the session ended, no window to wait for.
      expect(secretaryStatus(ctx.db, stamp(T0 + 1000), gone)).toEqual({
        name: 'sol',
        state: 'offline',
        since: iso(T0),
        pending: 0,
      });
    });
  });
});
