import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rememberLanguage } from '../app/language.ts';
import { withMachine } from '../app/machine.ts';
import { cliAt, tempGitRepo } from './testing.ts';

// A board the CLI makes for the person (otea init --template, otea start --template) is in the
// project's language: the one the person used when the project was made, their desk's, whatever
// this shell's locale says (P4-F5, P5-F4), and the desk changing its own later does not move it
// (P8-F2).
describe('the language of a board made from the command line', () => {
  let repo: ReturnType<typeof tempGitRepo>;

  beforeEach(() => {
    repo = tempGitRepo();
  });

  afterEach(() => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
    repo.remove();
  });

  const boards = async (...argv: string[]) => {
    const { out } = await cliAt(repo.dir)('init', '--local', '--json', ...argv);
    return (JSON.parse(out) as { boards: { name: string }[] }).boards.map(({ name }) => name);
  };

  it('follows the desk when it is Spanish', async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));

    expect(await boards('--template', 'todos')).toEqual(['Pendientes']);
  });

  it('follows it when it is English', async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));

    expect(await boards('--template', 'todos')).toEqual(['To-dos']);
  });

  it('keeps the language the project was made in when the desk is Spanish by the next run', async () => {
    withMachine(process.env, (machine) => rememberLanguage(machine, 'en'));
    expect(await boards()).toEqual([]);

    withMachine(process.env, (machine) => rememberLanguage(machine, 'es'));

    expect(await boards('--template', 'todos')).toEqual(['To-dos']);
  });
});
