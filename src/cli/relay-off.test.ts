import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishBoard, saveDraft } from '../app/boards.ts';
import { liveBoardOf } from '../app/next.ts';
import { leaveNote } from '../app/notes.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// A board that turned relay off takes nothing an agent says the person said: not a relayed
// decision (relay.test.ts), nor an answer noted from the chat (otea answer), nor words that set an
// item aside again after the person took it up (otea release --later --quote).
describe('the words of the person, through an agent, on a board with relay off', () => {
  let repo: TempRepo;
  let otea: Cli;

  async function boardOn(relay: boolean) {
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
      'Facturas',
      '--field',
      'Qué quiero=x',
    );
    const project = openProject(repo.dir);
    try {
      const live = liveBoardOf(project, 'Cambios');
      if (!live) throw new Error('no board');
      const doit = live.def.steps.find(({ name }) => name === 'Hacerlo');
      if (!doit) throw new Error('no Hacerlo');
      updateItemState(
        project.db,
        'CAM-1',
        stateOf({ step: doit.id, phase: 'doing' }),
        '2026-11-18T10:00:00Z',
      );
      if (!relay) {
        saveDraft(project, live.id, {
          definition: { ...live.def, relay: false },
          baseVersion: live.version,
        });
        publishBoard(project, live.id, { moves: {}, by: { kind: 'human', name: 'fede' } });
      }
    } finally {
      project.db.close();
    }
    expect((await otea('claim', 'CAM-1')).code).toBe(0);
  }

  afterEach(() => repo.remove());

  describe('otea answer', () => {
    it('is refused, telling the agent the person answers on the desk', async () => {
      await boardOn(false);
      expect((await otea('ask', 'CAM-1', 'Which invoices?')).code).toBe(0);

      const { code, err } = await otea('answer', 'CAM-1', 'The 2025 ones');

      expect(code).toBe(7);
      expect(err).toContain('does not take');
      expect(err).toContain('otea ask');
      // The question still waits for the person.
      expect((await otea('show', 'CAM-1')).out).toContain('Waiting for the person to answer');
    });

    it('notes the answer as ever on a board that keeps relay on', async () => {
      await boardOn(true);
      expect((await otea('ask', 'CAM-1', 'Which invoices?')).code).toBe(0);

      expect((await otea('answer', 'CAM-1', 'The 2025 ones')).code).toBe(0);
    });
  });

  describe('otea release --later --quote', () => {
    // The person took the item up again after the agent set it aside: only their newer words,
    // relayed, set it aside again.
    async function retaken() {
      expect((await otea('release', 'CAM-1', '--later')).code).toBe(0);
      const project = openProject(repo.dir);
      try {
        leaveNote(project, {
          id: 'CAM-1',
          text: 'Do it now',
          channel: 'ui',
          actor: { kind: 'human', name: 'fede' },
        });
      } finally {
        project.db.close();
      }
      expect((await otea('reply', 'CAM-1', '--note', '1', 'On it')).code).toBe(0);
    }

    it('does not let a quote lift the guard, and says to ask the person', async () => {
      await boardOn(false);
      await retaken();

      const { code, err } = await otea('release', 'CAM-1', '--later', '--quote', 'invented');

      expect(code).toBe(4);
      expect(err).toContain('took it up again');
      expect(err).toContain('otea ask');
      expect(err).not.toContain('--quote "<the person');
    });

    it('lets a quote lift the guard on a board that keeps relay on', async () => {
      await boardOn(true);
      await retaken();

      expect((await otea('release', 'CAM-1', '--later', '--quote', 'next week')).code).toBe(0);
    });
  });
});
