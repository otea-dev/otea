import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LISTEN_WINDOW_MS } from '../core/agent-status.ts';
import { UNHEARD_GRACE_MS } from '../core/notify/signals.ts';
import { selectStretches } from '../store/secretary.ts';
import { addCollection } from './collections.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import {
  endProcess,
  endWaiter,
  endWaiting,
  forgetGoneHarness,
  listAgents,
  noteHarness,
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

      // Its harness session (noted by its wait) is the one process left to ask about.
      describe('with the harness session it runs under noted', () => {
        const harness = 4242;
        beforeEach(() => noteHarness(ctx.db, 'sol', harness));
        const only = (pid: number) => (other: number) => other === pid;

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
