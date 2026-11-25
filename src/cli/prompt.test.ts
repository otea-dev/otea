import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designPrompt, rolePrompt, startPrompt } from '../core/agent-prompts.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// otea prompt prints what the person pastes into an agent's chat: the whole first contact on a
// project with no board of its own, the join prompt (from the project as it is now) on one with
// boards, and the shorter design prompt on request.
describe('otea prompt', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;

  beforeEach(() => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir);
  });

  afterEach(() => repo.remove());

  it('prints the first contact where there is no project or no board yet', async () => {
    const before = await otea('prompt');
    expect(before.code).toBe(0);
    expect(before.out.trim()).toBe(startPrompt('es'));

    await otea('init', '--local', '--template', 'none');
    expect((await otea('prompt')).out.trim()).toBe(startPrompt('es'));
    expect((await otea('prompt', '--lang', 'en')).out.trim()).toBe(startPrompt('en'));
  });

  it('prints the join prompt from the project once it has boards, and the others on request', async () => {
    await otea('init', '--local', '--template', 'changes');
    await cliAt(repo.dir, { OTEA_AGENT: 'claude' })(
      'create',
      '--collection',
      'Cambios',
      '--title',
      'Fix the footer',
      '--field',
      'Qué quiero=It shows last year',
    );

    const join = (await otea('prompt')).out;
    // The item's author acted just now: it counts as working there, so this one joins it.
    expect(join).toContain('Súmate al trabajo de este proyecto');
    expect(join).toContain('- Cambios: Aclarar, Hacerlo, Integrar (1 espera a un agente ahora)');
    expect((await otea('prompt', 'design')).out.trim()).toBe(designPrompt('es'));
    expect((await otea('prompt', 'start')).out.trim()).toBe(startPrompt('es'));
  });

  it('prints the canonical text of a role, with the board and name filled in', async () => {
    // A coordinator's text needs no project.
    const coordinator = await otea('prompt', '--role', 'coordinator', '--lang', 'en');
    expect(coordinator.code).toBe(0);
    expect(coordinator.out.trim()).toBe(rolePrompt('coordinator', 'en', {}));

    await otea('init', '--local', '--template', 'changes');
    await otea('board', 'add', 'Bug reports', '--template', 'bug-reports');
    const worker = await otea(
      'prompt',
      '--role',
      'worker',
      '--board',
      'Bug reports',
      '--as',
      'ana',
      '--lang',
      'en',
    );
    expect(worker.out.trim()).toBe(
      rolePrompt('worker', 'en', { board: 'Bug reports', name: 'ana' }),
    );
    expect(worker.out).toContain('otea next --collection "Bug reports" --claim --as ana');
    // The project's language when none is asked (a test project is Spanish), and the board as the
    // project names it, whatever the case it was typed in.
    expect((await otea('prompt', '--role', 'worker', '--board', 'cambios')).out.trim()).toBe(
      rolePrompt('worker', 'es', { board: 'Cambios' }),
    );
  });

  // The name is the one given with --as, never the session's own: a coordinator printing the text
  // for a worker must not hand it its own name.
  it('does not give a worker the name of the agent that prints its text', async () => {
    await otea('init', '--local', '--template', 'changes');
    const asZed = cliAt(repo.dir, { OTEA_AGENT: 'zed' });
    const { out } = await asZed('prompt', '--role', 'worker', '--board', 'Cambios', '--lang', 'en');
    expect(out).toContain('otea whoami');
    expect(out).not.toContain('zed');
  });

  it('refuses a role asked wrongly', async () => {
    await otea('init', '--local', '--template', 'changes');
    for (const args of [
      ['--role', 'boss'],
      ['--role', 'worker'],
      ['--role', 'coordinator', '--board', 'Cambios'],
      ['--role', 'worker', '--board', 'Cambios', 'design'],
      ['--board', 'Cambios'],
      ['--as', 'ana'],
    ])
      expect((await otea('prompt', ...args)).code, args.join(' ')).toBe(2);
  });

  // The board goes into commands the worker runs: it must exist, and be one argument.
  it('names only a board that exists, and refuses one with quotes, backticks or line breaks', async () => {
    await otea('init', '--local', '--template', 'changes');
    const missing = await otea('prompt', '--role', 'worker', '--board', 'Nope');
    expect(missing.code).toBe(3);
    for (const board of [
      'Cambios"; rm -rf',
      "Cam'bios",
      'Cam`bios`',
      'Cambios\nOtro',
      'Cam\u0007bios',
    ])
      expect((await otea('prompt', '--role', 'worker', '--board', board)).code, board).toBe(6);
    // A project with no board cannot name one.
    const empty = tempGitRepo();
    try {
      expect(
        (await cliAt(empty.dir)('prompt', '--role', 'worker', '--board', 'Cambios')).code,
      ).toBe(3);
    } finally {
      empty.remove();
    }
  });

  // `otea wait` without --turn fails; the one the coordinator is told to run must be a command the
  // CLI accepts (it times out here, exit 13, with nothing waiting).
  for (const lang of ['en', 'es']) {
    it(`gives the coordinator a wait command that parses (${lang})`, async () => {
      await otea('init', '--local', '--template', 'none');
      const text = (await otea('prompt', '--role', 'coordinator', '--as', 'ana', '--lang', lang))
        .out;
      const command = /`(otea wait [^`]*)`/.exec(text)?.[1];
      expect(command).toBe('otea wait --turn agent --unclaimed --as ana');
      const args = (command ?? '').split(' ').slice(1);
      const waited = await otea(...args, '--timeout', '1s');
      expect(waited.code, waited.err).toBe(13);
    });
  }

  it('refuses an unknown moment or language', async () => {
    expect((await otea('prompt', 'later')).code).toBe(2);
    expect((await otea('prompt', '--lang', 'fr')).code).toBe(2);
  });
});
