import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// P1-R3-4: the person said in the chat to discard CAM-1; in Hacerlo otea drop answered only «only
// the person drops items here», while show listed «Agent can relay to: Dropped», and two agents
// dead-ended. The refusal names the relay that records the person's own decision, as it works.
describe('a drop the person asked for in the chat', () => {
  let repo: TempRepo;
  let otea: Cli;

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Cambios', '--template', 'changes');
    declareProfiles(repo.dir, 'quill');
    await otea(
      'create',
      '--collection',
      'Cambios',
      '--title',
      'Regar',
      '--field',
      'Qué quiero=x',
      '--field',
      'Rama=cambio/1-regar',
    );
    const project = openProject(repo.dir);
    try {
      const doit = liveBoardOf(project, 'Cambios')?.def.steps.find(
        ({ name }) => name === 'Hacerlo',
      );
      if (!doit) throw new Error('no Hacerlo');
      updateItemState(
        project.db,
        'CAM-1',
        stateOf({ step: doit.id, phase: 'doing' }),
        '2026-11-19T10:00:00Z',
      );
    } finally {
      project.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
  });

  afterEach(() => repo.remove());

  it('names how to ask the person, since a relay never drops', async () => {
    const refused = await otea('drop', 'CAM-1', '--reason', 'ya no hace falta');
    expect(refused.code).toBe(7);
    expect(refused.err).toContain(
      'Not dropped CAM-1: only the person drops items here. If the person may want it dropped, ask them with otea ask CAM-1 "<your question>"; the secretary offers them a card to tap (otea say --drop CAM-1), and a relayed sentence never drops an item.',
    );

    // A relay never drops, with the person's words or without them.
    const relayed = await otea(
      'relay',
      'CAM-1',
      'Dropped',
      '--quote',
      'descártalo ya',
      '--reason',
      'ya no hace falta',
      '--motive',
      'Ya no hace falta',
    );
    expect(relayed.code).toBe(7);
    expect(relayed.err).toContain("person's alone");
  });
});
