import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designPrompt, rolePrompt, startPrompt } from '../core/agent-prompts.ts';
import { findCommand } from './commands.ts';
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
    // The assistant's and the refiner's texts need no project.
    const assistant = await otea('prompt', '--role', 'assistant', '--lang', 'en');
    expect(assistant.code).toBe(0);
    expect(assistant.out.trim()).toBe(rolePrompt('assistant', 'en', {}));
    const refiner = await otea('prompt', '--role', 'refiner', '--as', 'rita', '--lang', 'es');
    expect(refiner.code).toBe(0);
    expect(refiner.out.trim()).toBe(rolePrompt('refiner', 'es', { name: 'rita' }));

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

  // The name is the one given with --as, never the session's own: an assistant printing the text
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
      ['--role', 'coordinator'],
      ['--role', 'assistant', '--board', 'Cambios'],
      ['--role', 'refiner', '--board', 'Cambios'],
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

  // `otea wait` without --turn fails; the one the assistant is told to run is the assistant's own,
  // and must be a command the CLI accepts (it times out here, exit 13, with nothing waiting).
  for (const lang of ['en', 'es']) {
    it(`gives the assistant a wait command that parses and runs (${lang})`, async () => {
      await otea('init', '--local', '--template', 'none');
      await otea('profile', '--role', 'assistant', '--as', 'ana');
      const text = (await otea('prompt', '--role', 'assistant', '--as', 'ana', '--lang', lang)).out;
      const command = /`(otea wait [^`]*)`/.exec(text)?.[1];
      expect(command).toBe('otea wait --assistant --as ana');
      const args = (command ?? '').split(' ').slice(1);
      const waited = await otea(...args, '--timeout', '1s');
      expect(waited.code, waited.err).toBe(13);
    });
  }

  // Every command a role text tells an agent to run is a real one, with options it takes: the CLI's
  // own command table is the judge. A placeholder (<id>) stands for a value; `$` alternatives and
  // the notes in the text are not commands.
  describe('the commands in the role texts', () => {
    const GLOBAL = new Set(['json', 'as', 'help', 'version']);
    const texts = (['en', 'es'] as const).flatMap((lang) => [
      { what: `assistant ${lang}`, text: rolePrompt('assistant', lang, {}) },
      { what: `worker ${lang}`, text: rolePrompt('worker', lang, { board: 'Cambios' }) },
      { what: `refiner ${lang}`, text: rolePrompt('refiner', lang, {}) },
    ]);

    for (const { what, text } of texts) {
      it(`are real commands with real options (${what})`, () => {
        const commands = [...text.matchAll(/`(otea [^`]+)`/g)].map((found) => found[1] ?? '');
        expect(commands.length).toBeGreaterThan(3);
        for (const line of commands) {
          // Words and options apart from quoted values (a "<question>" with spaces is one value).
          const bare = line.replace(/"[^"]*"/g, '"x"').replace(/<[^>]*>/g, '<x>');
          const tokens = (bare.match(/\S+/g) ?? []).slice(1);
          const command = findCommand(tokens);
          expect(command, line).toBeDefined();
          const words = command?.name.split(' ').length ?? 0;
          const given = tokens.slice(words);
          for (const token of given) {
            if (!token.startsWith('--')) continue;
            const name = token.slice(2);
            expect(
              GLOBAL.has(name) || command?.options[name] !== undefined,
              `${line}: --${name}`,
            ).toBe(true);
          }
          // The arguments a command takes: no more than it names.
          const positionals = given.filter((token, index) => {
            const before = given[index - 1]?.startsWith('--')
              ? given[index - 1]?.slice(2)
              : undefined;
            const spec = before === undefined ? undefined : command?.options[before];
            const valued = before === 'as' || (spec !== undefined && spec.flag !== true);
            return !token.startsWith('--') && !valued;
          });
          expect(positionals.length, line).toBeLessThanOrEqual(command?.args.length ?? 0);
        }
      });
    }
  });

  it('refuses an unknown moment or language', async () => {
    expect((await otea('prompt', 'later')).code).toBe(2);
    expect((await otea('prompt', '--lang', 'fr')).code).toBe(2);
  });
});
