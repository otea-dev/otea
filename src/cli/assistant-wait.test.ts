import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assistantName,
  assistantWake,
  emitAssistantSignal,
  startAssistantWait,
} from '../app/assistant.ts';
import { createItem } from '../app/items.ts';
import { listAgents } from '../app/presence.ts';
import { openProject, type Project } from '../app/project.ts';
import type { AssistantSignalKind } from '../core/assistant.ts';
import { UNHEARD_GRACE_MS } from '../core/notify/signals.ts';
import {
  type Cli,
  declareProfiles,
  presetCollection,
  seedOnce,
  startCli,
  type TempRepo,
  until,
} from './testing.ts';

// The assistant role and its wait (0.8, M1): declared through profile or connect, one per project,
// and woken by `otea wait --assistant`.
describe('the assistant and its wait', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'luna', 'worker');
    presetCollection(dir, 'tasks');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  const settled = async (running: { done: Promise<number> }) =>
    Promise.race([running.done.then(() => true), delay(400).then(() => false)]);

  // What the conversation (M2), the Bandeja (M5) and an escalated question do through the app.
  const emit = (kind: AssistantSignalKind, ref: string, text?: string) => {
    const project = openProject(repo.dir);
    try {
      emitAssistantSignal(project.db, { kind, ref, ...(text === undefined ? {} : { text }) });
    } finally {
      project.db.close();
    }
  };

  const inProject = <T>(use: (project: Project) => T): T => {
    const project = openProject(repo.dir);
    try {
      return use(project);
    } finally {
      project.db.close();
    }
  };

  describe('declaring the role', () => {
    it('otea profile --role assistant makes the agent the assistant and says how it listens', async () => {
      const { code, out } = await otea('profile', '--role', 'assistant', '--as', 'sol', '--json');

      expect(code).toBe(0);
      expect(JSON.parse(out)).toMatchObject({ agent: 'sol', role: 'assistant', replaced: null });
      const text = (await otea('profile', '--role', 'assistant', '--as', 'sol')).out;
      expect(text).toContain("sol is this project's assistant");
      expect(text).toContain('otea wait --assistant --as sol');
    });

    it('otea connect --as <name> --role assistant does too', async () => {
      const { code } = await otea('connect', '--as', 'sol', '--role', 'assistant', '--cli');

      expect(code).toBe(0);
      expect((await otea('whoami', '--as', 'sol')).out).toContain(
        "You are this project's assistant",
      );
    });

    it('is refused for a second agent while the first is connected', async () => {
      await otea('profile', '--role', 'assistant', '--as', 'sol');

      const { code, err } = await otea('profile', '--role', 'assistant', '--as', 'luna');

      expect(code).toBe(12);
      expect(err).toContain("sol is this project's assistant and is not gone");
      expect((await otea('whoami', '--as', 'luna')).out).toContain(
        "This project's assistant is sol",
      );
    });

    // G1: the role was declared first, so a bad --effort left the agent the assistant with an error.
    it('declares nothing when its options are wrong: the agent does not become the assistant', async () => {
      const { code } = await otea(
        'profile',
        '--role',
        'assistant',
        '--as',
        'sol',
        '--model',
        'claude-opus-5-5',
        '--effort',
        'very high!',
        '--harness',
        'claude-code',
      );

      expect(code).not.toBe(0);
      expect(inProject((project) => assistantName(project.db))).toBeUndefined();
    });

    it('is no part of a connect --check, which declares nothing', async () => {
      const { code, err } = await otea('connect', '--as', 'sol', '--role', 'assistant', '--check');

      expect(code).toBe(2);
      expect(err).toContain('--role names the role of the agent given with --as');
      expect((await otea('whoami', '--as', 'sol')).out).not.toContain('assistant');
    });
  });

  describe('otea wait --assistant', () => {
    beforeEach(async () => {
      await otea('profile', '--role', 'assistant', '--as', 'sol');
    });

    it('is for the assistant only', async () => {
      const { code, err } = await otea('wait', '--assistant', '--as', 'luna', '--timeout', '1');

      expect(code).toBe(7);
      expect(err).toContain("luna is not this project's assistant (sol is)");
    });

    it('takes no --turn', async () => {
      const { code, err } = await otea('wait', '--assistant', '--turn', 'agent', '--as', 'sol');

      expect(code).toBe(2);
      expect(err).toContain('--assistant takes no --turn');
    });

    it('returns at once for a message from the person, and says to wait again', async () => {
      emit('person_message', 'm-1', 'the button is hidden');

      const { code, out } = await otea('wait', '--assistant', '--as', 'sol');

      expect(code).toBe(0);
      expect(out).toContain('The person wrote to you (m-1): the button is hidden');
      expect(out).toContain('otea wait --assistant --as sol');
    });

    it('prints what woke it as JSON with --json', async () => {
      emit('escalation', 'TASKS-3', 'which branch?');

      const { out } = await otea('wait', '--assistant', '--as', 'sol', '--json');

      expect(JSON.parse(out)).toMatchObject({
        assistant: 'sol',
        kind: 'escalation',
        ref: 'TASKS-3',
      });
    });

    it('blocks until a Bandeja capture arrives, then returns it once', async () => {
      const waiting = startCli(repo.dir, 'wait', '--assistant', '--as', 'sol');
      expect(await settled(waiting)).toBe(false);

      emit('bandeja_item', 'b-1');

      expect(await waiting.done).toBe(0);
      expect(waiting.out()).toContain('Inbox (b-1)');
      await otea('say', 'Looking at it.', '--as', 'sol');
      const again = await otea('wait', '--assistant', '--as', 'sol', '--timeout', '1');
      expect(again.code).toBe(13);
      expect(again.err).toContain('Nothing reached the assistant within 1s');
    });

    it('returns again what a lost wait returned, until the assistant acts with another command', async () => {
      emit('person_message', 'm-1');
      // A wait that returned and whose output was lost: nothing acted on it.
      expect((await otea('wait', '--assistant', '--as', 'sol')).out).toContain('(m-1)');

      const again = await otea('wait', '--assistant', '--as', 'sol', '--timeout', '1');
      expect(again.code).toBe(0);
      expect(again.out).toContain('(m-1)');

      // The assistant acts (it says something), and it is not returned again.
      await otea('say', 'Looking at it.', '--as', 'sol');
      const done = await otea('wait', '--assistant', '--as', 'sol', '--timeout', '1');
      expect(done.code).toBe(13);
    });

    it('gives one signal to one of two waits that run at once', async () => {
      const first = startCli(repo.dir, 'wait', '--assistant', '--as', 'sol');
      const second = startCli(repo.dir, 'wait', '--assistant', '--as', 'sol');
      expect(await settled(first)).toBe(false);

      emit('bandeja_item', 'b-1');
      await until(() => first.out() !== '' || second.out() !== '');
      await delay(700);

      expect([first.out(), second.out()].filter((out) => out !== '')).toHaveLength(1);
      await first.stop();
      await second.stop();
    });

    it('returns each source in the order it came', async () => {
      emit('person_message', 'm-1');
      emit('bandeja_item', 'b-1');
      emit('escalation', 'TASKS-2');

      const kinds: string[] = [];
      for (let n = 0; n < 3; n++) {
        const { out } = await otea('wait', '--assistant', '--as', 'sol', '--json');
        kinds.push(JSON.parse(out).kind);
        // The assistant acts on each before it waits again.
        await otea('say', 'Looking at it.', '--as', 'sol');
      }

      expect(kinds).toEqual(['person_message', 'bandeja_item', 'escalation']);
    });

    it('returns for a board with work and nobody listening once the grace passed, across waits', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const id = inProject(
          (project) =>
            createItem(project, {
              collection: 'tasks',
              title: 'First',
              fields: { description: 'D' },
              actor: { kind: 'agent', name: 'worker' },
            }).id,
        );
        // The first look starts the stretch; it is kept for the next wait to see.
        expect(
          inProject((project) => assistantWake(project, startAssistantWait())),
        ).toBeUndefined();

        vi.setSystemTime(Date.now() + UNHEARD_GRACE_MS + 1000);
        const { code, out } = await otea('wait', '--assistant', '--as', 'sol', '--json');

        expect(code).toBe(0);
        expect(JSON.parse(out)).toMatchObject({ kind: 'unheard', items: [id] });
      } finally {
        vi.useRealTimers();
      }
    });

    it('is not a listener on the boards while it waits', async () => {
      const waiting = startCli(repo.dir, 'wait', '--assistant', '--as', 'sol');
      expect(await settled(waiting)).toBe(false);

      try {
        const sol = inProject((project) =>
          listAgents(project.db).find(({ name }) => name === 'sol'),
        );
        expect(sol).toMatchObject({ role: 'assistant', attending: true, waiting: false });
        expect(sol?.status).toBe('connected');
      } finally {
        await waiting.stop();
      }
    });

    it('whoami says where the assistant stands, for the assistant and for the rest', async () => {
      expect((await otea('whoami', '--as', 'sol')).out).toContain(
        "You are this project's assistant (connected). Listen for the person with otea wait --assistant --as sol",
      );
      expect((await otea('whoami', '--as', 'worker')).out).toContain(
        "This project's assistant is sol (connected).",
      );
    });
  });
});
