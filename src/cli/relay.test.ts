import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { publishAs } from '../app/testing.ts';
import { stateOf } from '../core/board/engine.ts';
import { errores } from '../core/board/testing.ts';
import { updateItemState } from '../store/queries.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  presetCollection,
  seedOnce,
  type TempRepo,
  tempGitRepo,
} from './testing.ts';

const QUOTE = 'Discard it, the old flow is gone';
const USAGE =
  'Usage: otea relay <id> <state> --quote <what the human said> [--from-message <id>] [--reason <reason>]';

// A tasks board and the agents these tests name, with their profiles declared.
function tasksBoard(dir: string): void {
  declareProfiles(dir, 'claude', 'claude-a', 'claude-b', 'codex', 'gemini', 'quill');
  presetCollection(dir, 'tasks');
}

describe('relay', () => {
  let repo: TempRepo;
  let otea: Cli;

  const json = async (...argv: string[]) => JSON.parse((await otea(...argv, '--json')).out);

  const seeded = seedOnce(async (seed, dir) => {
    tasksBoard(dir);
    await seed('create', '--collection', 'tasks', '--title', 'Old flow', '--description', 'D');
    await seed('create', '--collection', 'tasks', '--title', 'Held', '--description', 'D');
    // Another agent did the step: an agent relays only decisions on work it did not do itself.
    await seed('handoff', 'TASKS-1', '--as', 'codex');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  it('moves the item as the human via the agent and prints it as a list row', async () => {
    const result = await otea('relay', 'TASKS-1', 'dropped', '--quote', QUOTE, '--reason', 'Gone');

    expect(result).toMatchObject({ code: 0, out: 'TASKS-1  Dropped  none  Old flow\n' });
    expect((await json('show', 'TASKS-1')).events.at(-1)).toMatchObject({
      type: 'transitioned',
      actor: { kind: 'human', name: 'human' },
      data: {
        from: 'todo__review',
        to: 'dropped',
        reason: 'Gone',
        channel: 'cli',
        via: 'claude',
        source: 'conversation',
        quote: QUOTE,
      },
    });
  });

  it('names the relaying agent with --as', async () => {
    await otea(
      'relay',
      'TASKS-1',
      'dropped',
      '--quote',
      QUOTE,
      '--reason',
      'Gone',
      '--as',
      'gemini',
    );

    expect((await json('show', 'TASKS-1')).events.at(-1).data.via).toBe('gemini');
  });

  it('shows the relay and the quote in the timeline of show', async () => {
    await otea('relay', 'TASKS-1', 'dropped', '--quote', QUOTE, '--reason', 'Gone');

    expect((await otea('show', 'TASKS-1')).out).toMatch(
      /relay:claude +transitioned {2}Hacerlo \(en revisión\) -> Dropped \(Gone\), relayed by claude, quoting "Discard it, the old flow is gone"$/m,
    );
  });

  it('never shows a relayed decision as the person’s own', async () => {
    await otea('relay', 'TASKS-1', 'dropped', '--quote', QUOTE, '--reason', 'Gone');

    expect((await otea('show', 'TASKS-1')).out).not.toMatch(/human:human +transitioned/);
  });

  it('prints the moved item with --json', async () => {
    const item = await json('relay', 'TASKS-1', 'dropped', '--quote', QUOTE, '--reason', 'x');

    expect(item).toMatchObject({ id: 'TASKS-1', state: 'dropped', turn: 'none' });
  });

  it('requires --quote, with the usage', async () => {
    const { code, err } = await otea('relay', 'TASKS-1', 'dropped', '--reason', 'Gone');

    expect(code).toBe(2);
    expect(err).toContain('Missing --quote for "otea relay"');
    expect(err).toContain(USAGE);
  });

  it('refuses a blank quote with quote_required (exit 2)', async () => {
    const { code, err } = await otea('relay', 'TASKS-1', 'dropped', '--quote', ' ', '--json');

    expect(code).toBe(2);
    expect(JSON.parse(err).error.code).toBe('quote_required');
    expect((await json('show', 'TASKS-1')).state).toBe('todo__review');
  });

  it('requires --reason when the transition does (exit 2)', async () => {
    const { code, err } = await otea('relay', 'TASKS-1', 'dropped', '--quote', QUOTE);

    expect(code).toBe(2);
    expect(err).toContain('Not dropped TASKS-1: say why with --reason.');
  });

  it('refuses a human-ui transition with forbidden (exit 7), pointing to the web UI', async () => {
    const { code, err } = await otea('relay', 'TASKS-1', 'done', '--quote', 'Approved', '--json');

    expect(code).toBe(7);
    expect(JSON.parse(err).error).toEqual({
      code: 'forbidden',
      message:
        'Moving from "Hacerlo (en revisión)" to "Done" requires human-ui authority (a human in the web UI) and cannot be relayed; the person gives it themselves on the desk or the phone: ask them with otea ask',
    });
    expect((await json('show', 'TASKS-1')).state).toBe('todo__review');
  });

  it('refuses an agent transition with not_relayable (exit 4), pointing to otea move', async () => {
    const { code, err } = await otea('relay', 'TASKS-2', 'todo__review', '--quote', 'Go ahead');

    expect(code).toBe(4);
    expect(err).toContain('make it with "otea move"');
  });

  // P8-F5: 'Cannot move from "Hacerlo" to "Hacerlo"' said nothing of why: a send-back is relayed
  // only while the person reviews the step, and this one is still the agent's.
  it.each(['todo', 'done'])(
    'says why an item still in its agent’s hands is not relayed to %s, and what to do',
    async (to) => {
      const { code, err } = await otea('relay', 'TASKS-2', to, '--quote', 'Send it back');

      expect(code).toBe(4);
      expect(err).not.toContain('Cannot move');
      expect(err).toContain('Not relayed: TASKS-2 is not in review, it is at Hacerlo');
      expect(err).toContain(
        'a send-back or an approval is relayed only while the person reviews it',
      );
      expect(err).toContain('otea handoff TASKS-2');
      expect(err).toContain('a relay can only move it to Dropped now');
    },
  );

  it('fails as usual for an invalid transition or an unknown item', async () => {
    expect((await otea('relay', 'TASKS-2', 'done', '--quote', 'Done')).code).toBe(4);
    expect((await otea('relay', 'TASKS-9', 'dropped', '--quote', 'x', '--reason', 'x')).code).toBe(
      3,
    );
  });

  it('is not blocked by a lease another agent holds, and releases it', async () => {
    await otea('claim', 'TASKS-2', '--as', 'codex');

    const result = await otea('relay', 'TASKS-2', 'dropped', '--quote', QUOTE, '--reason', 'x');

    expect(result.code).toBe(0);
    const item = await json('show', 'TASKS-2');
    expect(item.lease).toBeNull();
    expect(item.events.at(-1)).toMatchObject({
      type: 'released',
      actor: { kind: 'human', name: 'human' },
      data: { holder: 'codex', cause: 'handoff', via: 'claude' },
    });
  });
});

describe('relay of a decision on the agent’s own step', () => {
  let repo: TempRepo;
  let otea: Cli;

  const json = async (...argv: string[]) => JSON.parse((await otea(...argv, '--json')).out);

  const seeded = seedOnce(async (seed, dir) => {
    tasksBoard(dir);
    await seed('create', '--collection', 'tasks', '--title', 'Mine', '--description', 'D');
    await seed('handoff', 'TASKS-1');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  it('refuses it with forbidden (exit 7) and leaves the item in review', async () => {
    const { code, err } = await otea(
      'relay',
      'TASKS-1',
      'todo',
      '--quote',
      'dale',
      '--reason',
      'Redo',
      '--json',
    );

    expect(code).toBe(7);
    expect(JSON.parse(err).error).toEqual({
      code: 'forbidden',
      message:
        'Not relayed: claude did Hacerlo on TASKS-1 in this round, so it may not relay the decision on its own work; the person makes it in the web UI.',
      details: { kind: 'own_step', item: 'TASKS-1', step: 'Hacerlo', who: 'claude' },
    });
    expect((await json('show', 'TASKS-1')).state).toBe('todo__review');
  });

  it('refuses any human decision on it, a discard included', async () => {
    const { code } = await otea('relay', 'TASKS-1', 'dropped', '--quote', 'drop', '--reason', 'x');

    expect(code).toBe(7);
    expect((await json('show', 'TASKS-1')).state).toBe('todo__review');
  });

  it('lets another agent relay it', async () => {
    const relayed = ['relay', 'TASKS-1', 'todo', '--quote', 'redo', '--reason', 'Redo'];

    expect((await otea(...relayed, '--as', 'codex')).code).toBe(0);
    expect((await json('show', 'TASKS-1')).state).toBe('todo');
  });

  it('lets the agent relay again once a new round of the step is handed off by another', async () => {
    await otea('relay', 'TASKS-1', 'todo', '--quote', 'redo', '--reason', 'Redo', '--as', 'codex');
    await otea('handoff', 'TASKS-1', '--note', 'Redone', '--as', 'codex');

    const { code } = await otea('relay', 'TASKS-1', 'todo', '--quote', 'again', '--reason', 'R');

    expect(code).toBe(0);
  });
});

describe('relay by an agent that worked the step but did not hand it off', () => {
  let repo: TempRepo;
  let otea: Cli;

  const relay = (...extra: string[]) =>
    otea('relay', 'TASKS-1', 'todo', '--quote', 'redo', '--reason', 'Redo', ...extra);

  const seeded = seedOnce(async (seed, dir) => {
    tasksBoard(dir);
    await seed('create', '--collection', 'tasks', '--title', 'Mine', '--description', 'D');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  it('lets it relay when the agent only claimed the item and let it go untouched', async () => {
    await otea('claim', 'TASKS-1');
    await otea('release', 'TASKS-1');
    await otea('handoff', 'TASKS-1', '--as', 'codex');

    expect((await relay()).code).toBe(0);
  });

  it('refuses it when the agent attached evidence in this round', async () => {
    writeFileSync(join(repo.dir, 'notes.txt'), 'what I found');
    expect((await otea('attach', 'TASKS-1', 'notes.txt')).code).toBe(0);
    await otea('handoff', 'TASKS-1', '--as', 'codex');

    expect((await relay()).code).toBe(7);
  });

  it('refuses it when the agent changed the item’s fields in this round', async () => {
    await otea('update', 'TASKS-1', '--description', 'Sharper');
    await otea('handoff', 'TASKS-1', '--as', 'codex');

    expect((await relay()).code).toBe(7);
  });

  it('lets it relay once the work it did belongs to an earlier round', async () => {
    await otea('claim', 'TASKS-1');
    await otea('release', 'TASKS-1');
    await otea('handoff', 'TASKS-1', '--as', 'codex');
    await relay('--as', 'gemini');
    await otea('handoff', 'TASKS-1', '--note', 'Redone', '--as', 'codex');

    expect((await relay()).code).toBe(0);
  });
});

// P1-F1: any other agent relayed an invented quote and the Changes board's Hacerlo review moved
// into Integrar (the land step), then to Hecho, with no one reviewing. Approving what lands on main,
// or closes the item, is the person's, on the desk or the phone; a send-back may still be relayed.
describe('relay on the review of a step that leads to what lands or closes', () => {
  let repo: TempRepo;
  let otea: Cli;
  let inReview = '';
  let landing = '';

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'orch' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Cambios', '--template', 'changes');
    declareProfiles(repo.dir, 'orch', 'codex');
    await otea('create', '--collection', 'Cambios', '--title', 'Regar', '--field', 'Qué quiero=x');
    const project = openProject(repo.dir);
    try {
      const steps = liveBoardOf(project, 'Cambios')?.def.steps ?? [];
      const doit = steps.find(({ name }) => name === 'Hacerlo');
      const land = steps.find(({ name }) => name === 'Integrar');
      if (!doit || !land) throw new Error('no Hacerlo or Integrar');
      inReview = stateOf({ step: doit.id, phase: 'review' });
      landing = stateOf({ step: land.id, phase: 'doing' });
      updateItemState(project.db, 'CAM-1', inReview, '2026-11-18T10:00:00Z');
    } finally {
      project.db.close();
    }
  });

  afterEach(() => repo.remove());

  it('refuses a relayed approval into the land step, telling the agent the person gives it', async () => {
    const { code, err } = await otea(
      'relay',
      'CAM-1',
      'Integrar',
      '--quote',
      'yes approved go',
      '--json',
    );

    expect(code).toBe(7);
    const { message } = JSON.parse(err).error;
    expect(message).toContain('desk or the phone');
    expect(message).toContain('otea ask');
    const shown = JSON.parse((await otea('show', 'CAM-1', '--json')).out);
    expect(shown.state).toBe(inReview);
    // The approval is not even offered to relay: the send-back and the drop still are.
    const offered = shown.relayable.map(({ to }: { to: string }) => to);
    expect(offered).not.toContain(landing);
    expect(offered.length).toBeGreaterThan(0);
  });

  it('still relays a send-back from the same review', async () => {
    const { code, err } = await otea(
      'relay',
      'CAM-1',
      'Hacerlo',
      '--quote',
      'devuélvelo',
      '--reason',
      'Falta el carro',
    );

    expect(code, err).toBe(0);
    expect((await otea('show', 'CAM-1', '--json')).out).toContain('"actor":{"kind":"human"');
  });
});

// A board can turn relay off: nothing an agent says the person said is taken as their word there.
describe('relay on a board that turned it off', () => {
  let repo: TempRepo;
  let otea: Cli;

  async function bugOn(relay: boolean): Promise<string> {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    await otea('init', '--local', '--template', 'none');
    const project = openProject(repo.dir);
    try {
      const def = errores();
      def.drop.by = 'anyone';
      def.relay = relay;
      publishAs(project, def, 'berr');
    } finally {
      project.db.close();
    }
    const created = await otea('create', '--collection', 'Errores', '--title', 'Faro', '--json');
    return JSON.parse(created.out).id;
  }

  const discard = (id: string) =>
    otea('relay', id, 'Dropped', '--motive', 'Duplicado', '--quote', 'tíralo', '--reason', 'x');

  afterEach(() => repo.remove());

  it('refuses it, tells the agent to ask the person, and leaves the item as it was', async () => {
    const id = await bugOn(false);

    const { code, err } = await discard(id);

    expect(code).toBe(7);
    expect(err).toContain('otea ask');
    expect(err).toContain('Errores');
    expect(JSON.parse((await otea('show', id, '--json')).out).state).not.toBe('dropped__duplicate');
  });

  it('does not offer a relay in show either', async () => {
    const id = await bugOn(false);

    expect((await otea('show', id)).out).not.toContain('Agent can relay to:');
  });

  it('relays as ever on a board that keeps it on', async () => {
    const id = await bugOn(true);

    expect((await discard(id)).code).toBe(0);
  });
});

describe('move by an agent', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (seed, dir) => {
    tasksBoard(dir);
    await seed('create', '--collection', 'tasks', '--title', 'T', '--description', 'D');
    await seed('handoff', 'TASKS-1');
  });

  beforeEach(() => {
    ({ repo, otea } = seeded.fresh());
  });

  afterEach(() => repo.remove());

  it.each([
    ['done', []],
    ['todo', ['--reason', 'Redo']],
  ])('refuses %s from the person’s review with forbidden', async (to, extra) => {
    const { code, err } = await otea('move', 'TASKS-1', to, ...extra);

    expect(code).toBe(7);
    // On a board, the step engine says whose review it is.
    expect(err).toContain('Not your turn: the person reviews Hacerlo on TASKS-1');
  });
  it('refuses dropped as otea drop does: only the person drops items here', async () => {
    const { code, err } = await otea('move', 'TASKS-1', 'dropped', '--reason', 'Drop');

    expect(code).toBe(7);
    expect(err).toContain('Not dropped TASKS-1: only the person drops items here.');
  });
});
