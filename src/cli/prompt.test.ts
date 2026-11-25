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
    const coordinator = await otea('prompt', '--role', 'coordinator', '--lang', 'en');
    expect(coordinator.code).toBe(0);
    expect(coordinator.out.trim()).toBe(rolePrompt('coordinator', 'en', {}));

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
    // The project's language when none is asked (a test project is Spanish).
    expect((await otea('prompt', '--role', 'worker', '--board', 'Cambios')).out.trim()).toBe(
      rolePrompt('worker', 'es', { board: 'Cambios' }),
    );
  });

  // The name is the one given with --as, never the session's own: a coordinator printing the text
  // for a worker must not hand it its own name.
  it('does not give a worker the name of the agent that prints its text', async () => {
    const asZed = cliAt(repo.dir, { OTEA_AGENT: 'zed' });
    const { out } = await asZed('prompt', '--role', 'worker', '--board', 'Cambios', '--lang', 'en');
    expect(out).toContain('otea whoami');
    expect(out).not.toContain('zed');
  });

  it('refuses a role asked wrongly', async () => {
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

  it('refuses an unknown moment or language', async () => {
    expect((await otea('prompt', 'later')).code).toBe(2);
    expect((await otea('prompt', '--lang', 'fr')).code).toBe(2);
  });
});
