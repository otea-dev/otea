import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LISTEN_WINDOW_MS } from '../core/agent-status.ts';
import { UNHEARD_GRACE_MS } from '../core/notify/signals.ts';
import { addCollection } from './collections.ts';
import type { Context } from './context.ts';
import { createItem } from './items.ts';
import { listAgents, waitBeat } from './presence.ts';
import {
  declareSecretary,
  emitSecretarySignal,
  requireSecretary,
  secretaryName,
  secretaryStatus,
  secretaryWake,
} from './secretary.ts';
import { memoryContext } from './testing.ts';
import { unheardOf } from './unheard.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const stamp = (ms: number) => () => new Date(ms).toISOString();

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

    it('lets a new session take over from a secretary that is gone', () => {
      wait('sol', T0);
      declareSecretary(ctx.db, 'sol', stamp(T0), running);

      const later = T0 + LISTEN_WINDOW_MS + 60_000;
      const declared = declareSecretary(ctx.db, 'luna', stamp(later), gone);

      expect(declared).toEqual({ agent: 'luna', role: 'secretary', replaced: 'sol' });
      expect(secretaryName(ctx.db)).toBe('luna');
      const roles = listAgents(ctx.db, stamp(later), gone).map(({ name, role }) => [name, role]);
      expect(roles).toContainEqual(['sol', null]);
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
    // What its wait finds `ms` after the start.
    const look = (ms: number) => secretaryWake(ctx, stamp(T0 + ms), running);

    it('a message from the person, a Bandeja capture and an escalated question, oldest first, once each', () => {
      emitSecretarySignal(ctx.db, { kind: 'person_message', ref: 'm-1', text: 'hola' }, stamp(T0));
      emitSecretarySignal(ctx.db, { kind: 'bandeja_item', ref: 'b-1' }, stamp(T0 + 1));
      emitSecretarySignal(ctx.db, { kind: 'escalation', ref: 'TASKS-4' }, stamp(T0 + 2));

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

    it('a board with work and nobody listening, once it stayed so for the grace', () => {
      const id = newTask(T0);
      // The grace counts from the first look, across waits that end and begin again.
      expect(look(0)).toBeUndefined();
      expect(look(UNHEARD_GRACE_MS - 1000)).toBeUndefined();

      expect(look(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'unheard', items: [id] });
      // Told once for the stretch.
      expect(look(UNHEARD_GRACE_MS + 5000)).toBeUndefined();
    });

    it('not for work a worker is listening for', () => {
      newTask(T0);
      look(0);
      wait('worker', T0 + UNHEARD_GRACE_MS - 1000, 202);

      expect(look(UNHEARD_GRACE_MS)).toBeUndefined();
    });

    it('while only the secretary itself waits', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      const id = newTask(T0);
      wait('sol', T0);
      look(0);
      wait('sol', T0 + UNHEARD_GRACE_MS);

      expect(look(UNHEARD_GRACE_MS)).toMatchObject({ items: [id] });
    });

    it('a signal first, and the unheard board after it', () => {
      const id = newTask(T0);
      look(0);
      emitSecretarySignal(ctx.db, { kind: 'person_message', ref: 'm-2' }, stamp(T0));

      expect(look(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'person_message' });
      expect(look(UNHEARD_GRACE_MS)).toMatchObject({ kind: 'unheard', items: [id] });
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

      // Its wait process is gone: the session ended, no listening window to wait for.
      expect(secretaryStatus(ctx.db, stamp(T0 + 1000), gone)).toEqual({
        name: 'sol',
        state: 'offline',
        since: new Date(T0).toISOString(),
        pending: 0,
      });
    });

    it('says offline when it was not heard for the listening window', () => {
      declareSecretary(ctx.db, 'sol', stamp(T0), running);
      wait('sol', T0);

      const status = secretaryStatus(ctx.db, stamp(T0 + LISTEN_WINDOW_MS + 1000), running);
      expect(status).toMatchObject({ state: 'offline', since: new Date(T0).toISOString() });
    });
  });
});
