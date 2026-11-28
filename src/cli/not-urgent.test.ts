import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rolePrompt } from '../core/agent-prompts.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// D-997a37 (field study s-real): a note written «no urgente, revisarlo después» became an item and an
// agent started it at once. The texts of the assistant and the refiner say to set such an item aside
// as soon as it is made, and an item set aside that way is not offered to any worker.
describe('a note that says it is not urgent', () => {
  let repo: TempRepo;
  let agent: Cli;

  beforeEach(async () => {
    repo = tempGitRepo();
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    await person('board', 'add', 'Changes', '--template', 'changes', '--lang', 'en');
    declareProfiles(repo.dir, 'quill');
    agent = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

  const create = () =>
    agent(
      'create',
      '--collection',
      'Changes',
      '--title',
      'Check the invoice totals',
      '--field',
      'What I want=check the totals',
    );

  it('is offered to a worker when nobody set it aside', async () => {
    const made = await create();
    expect(made.code, made.err).toBe(0);

    const woke = await agent('wait', '--turn', 'agent', '--unclaimed', '--timeout', '1s');

    expect(woke.code, woke.err).toBe(0);
    expect(woke.out).toMatch(/^CHA-1 /);
  });

  it('waits for the person to take it up when it was set aside right after it was made', async () => {
    const made = await create();
    expect(made.code, made.err).toBe(0);

    const aside = await agent(
      'release',
      'CHA-1',
      '--later',
      '--quote',
      'not urgent, look at it later',
    );
    expect(aside.code, aside.err).toBe(0);

    expect((await agent('wait', '--turn', 'agent', '--unclaimed', '--timeout', '1s')).code).toBe(
      13,
    );
  });

  for (const lang of ['en', 'es'] as const) {
    for (const role of ['assistant', 'refiner'] as const) {
      it(`is told to the ${role} in ${lang}: set the item aside with release --later --quote`, () => {
        const text = rolePrompt(role, lang, { name: 'quill' });

        expect(text).toContain('otea release <');
        expect(text).toContain('--later --quote');
      });
    }
  }
});
