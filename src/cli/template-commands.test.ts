import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEvidence, type Part } from '../core/board/model.ts';
import {
  instantiate,
  isSetKey,
  LANGS,
  type Lang,
  LISTED_KEYS,
  requireSet,
  requireTemplate,
} from '../core/board/templates.ts';
import { type Cli, cliAt, SEED_TIMEOUT_MS, type TempRepo, tempGitRepo } from './testing.ts';

// Every board a person can add from a template tells an agent what to run: "To add one" in
// `otea board <name>`, and commands inside the steps' own words. An agent follows them as written,
// so each one must work on the board that says it: the fields it names are fields of that board
// (an attachment is not one), the values are ones the field takes, the ways are steps of the
// board, and `--description` finds a field to fill.

type Command = { sub: string; args: string[]; flags: [flag: string, value: string][] };

const FLAGS_WITHOUT_VALUE = new Set(['--unclaimed', '--json', '--local']);
const trimmed = (word: string) => word.replace(/[,.;)]+$/, '');

// The commands written in a text. A command is its words as written: quoted pieces stay whole, a
// flag takes the word after it, and it ends at the first word that is prose.
function commandsIn(text: string): Command[] {
  return [...text.matchAll(/\botea (create|update|handoff)\b([^\n]*)/g)].map((match) => {
    const words = [...(match[2] ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '');
    const args: string[] = [];
    const flags: [string, string][] = [];
    for (let at = 0; at < words.length; at++) {
      const word = trimmed(words[at] ?? '');
      if (word.startsWith('--')) {
        flags.push([word, FLAGS_WITHOUT_VALUE.has(word) ? '' : trimmed(words[++at] ?? '')]);
      } else if (/^<[^>]+>$/.test(word) && flags.length === 0) args.push(word);
      else break;
    }
    return { sub: match[1] ?? '', args, flags };
  });
}

// A value a field takes, by its kind, to fill the "…" an agent is told to replace.
function valueFor(part: Part | undefined): string {
  switch (part?.kind) {
    case 'choice':
    case 'multi':
      return part.options[0]?.name ?? 'x';
    case 'level':
      return 'medium';
    case 'yesno':
      return 'yes';
    case 'number':
      return '1';
    case 'date':
      return '2026-03-01';
    case 'url':
      return 'https://example.com';
    case 'branch':
      return 'feat/x';
    default:
      return 'texto';
  }
}

describe.each(LANGS)('what the listed templates tell an agent to run, in %s', (lang: Lang) => {
  let repo: TempRepo;
  let agent: Cli;
  // The single-board template of each board of the project, by board name.
  const made = new Map<string, string>();
  const boardsOf = (key: string) =>
    (isSetKey(key) ? requireSet(key).boards : [key]).map((template) => ({
      template,
      name: requireTemplate(template).board[lang],
    }));

  beforeAll(async () => {
    repo = tempGitRepo();
    const env = { LANG: lang === 'es' ? 'es_ES.UTF-8' : 'en_US.UTF-8' };
    const person = cliAt(repo.dir, env);
    agent = cliAt(repo.dir, { ...env, OTEA_AGENT: 'claude' });
    await person('init', '--local');
    for (const key of LISTED_KEYS) {
      const [first] = boardsOf(key);
      const added = await person(
        'board',
        'add',
        first?.name ?? '',
        '--template',
        key,
        '--lang',
        lang,
      );
      expect(added.err).toBe('');
      for (const { template, name } of boardsOf(key)) made.set(name, template);
    }
  }, SEED_TIMEOUT_MS * 2);

  afterAll(() => repo.remove());

  const definitions = new Map<string, ReturnType<typeof instantiate>>();
  const definitionOf = (board: string) => {
    const known = definitions.get(board);
    if (known) return known;
    const def = instantiate(requireTemplate(made.get(board) ?? ''), lang, {});
    definitions.set(board, def);
    return def;
  };
  const partNamed = (board: string, name: string) =>
    Object.values(definitionOf(board).parts).find((part) => part.name === name);
  const fieldArgs = (board: string, specs: readonly string[]) =>
    specs.flatMap((spec) => {
      const name = spec.replace(/=.*$/, '');
      return ['--field', `${name}=${valueFor(partNamed(board, name))}`];
    });

  // Adds an item the way "To add one" says, and returns its id. A board whose items are always part
  // of another gets one under a new item of that board, as its refusal says.
  async function add(board: string, extra: string[] = [], skipLong = false): Promise<string> {
    const text = (await agent('board', board)).out;
    const line = text
      .split('\n')
      .find((candidate) => candidate.includes('otea create --collection'));
    expect(line, `${board} says how to add one`).toBeDefined();
    const [create] = commandsIn(line ?? '');
    const given = (create?.flags ?? [])
      .filter(([flag]) => flag === '--field')
      .map(([, spec]) => spec)
      .filter((spec) => !skipLong || partNamed(board, spec.replace(/=.*$/, ''))?.kind !== 'long');
    for (const spec of given) {
      const part = partNamed(board, spec.replace(/=.*$/, ''));
      expect(part, `${board}: "${spec}" names a field`).toBeDefined();
      expect(part && isEvidence(part), `${board}: "${spec}" is not an attachment`).toBe(false);
    }
    const argv = ['create', '--collection', board, '--title', 'Una prueba', '--json'];
    let created = await agent(...argv, ...fieldArgs(board, given), ...extra);
    const parent = /"parent":"([^"]+)"/.exec(created.err)?.[1];
    if (parent && !extra.includes('--parent')) {
      const owner = [...made.keys()].find((name) => definitionOf(name).item === parent);
      expect(owner, `${board}: a ${parent} board exists`).toBeDefined();
      const above = await add(owner ?? '');
      created = await agent(...argv, ...fieldArgs(board, given), ...extra, '--parent', above);
    }
    expect(created.err, `${board}: ${line?.trim()}`).toBe('');
    const id = JSON.parse(created.out).id as string;
    // A piece of evidence the form asks is attached with the line "To add one" gives, as written.
    for (const [, module = ''] of text.matchAll(/otea attach <id> <file> --module "([^"]+)"/g)) {
      repo.write('reference.png', 'not really a picture');
      const attached = await agent(
        'attach',
        id,
        join(repo.dir, 'reference.png'),
        '--module',
        module,
      );
      expect(attached.err, `${board}: otea attach <id> <file> --module "${module}"`).toBe('');
    }
    return id;
  }

  describe.each(LISTED_KEYS)('%s', (key) => {
    it('"To add one" creates an item, and --description fills the first long text', async () => {
      for (const { name } of boardsOf(key)) {
        await add(name);
        // `--description` stands for the long text the form asks first, so it replaces that field.
        const id = await add(name, ['--description', 'texto'], true);
        const item = JSON.parse((await agent('show', id, '--json')).out);
        const long = definitionOf(name).form.flatMap(({ ref }) => {
          const part = definitionOf(name).parts[ref];
          return part?.kind === 'long' ? [part.name] : [];
        })[0];
        expect(
          item.fields,
          `${name}: --description reached ${long ?? 'a long text'}`,
        ).toContainEqual(expect.objectContaining({ name: long, value: 'texto' }));
      }
    });

    it('every command in its words names fields, values, ways and boards the board has', async () => {
      for (const { name } of boardsOf(key)) {
        const text = (await agent('board', name)).out;
        const definition = definitionOf(name);
        const steps = new Set(definition.steps.map((step) => step.name));
        let at: string | undefined;
        // "To add one" is tried above; what is left are the commands the steps' words give.
        const written = commandsIn(text).filter(
          ({ flags }) => !flags.some(([flag]) => flag === '--title'),
        );
        for (const command of written) {
          const field = command.flags
            .filter(([flag]) => flag === '--field')
            .map(([, spec]) => spec);
          const collection = command.flags.find(([flag]) => flag === '--collection')?.[1];
          // Prose that names the command alone (otea create --parent) is not one to run.
          if (command.sub === 'create' && collection === undefined) continue;
          const target = collection ?? name;
          if (target.startsWith('<')) continue;
          expect(made.has(target), `${name}: ${command.sub} names the board "${target}"`).toBe(
            true,
          );
          if (command.sub === 'handoff') {
            const way = command.flags.find(([flag]) => flag === '--way')?.[1];
            expect(steps.has(way ?? ''), `${name}: --way "${way}" is a step`).toBe(true);
            continue;
          }
          for (const spec of field) {
            const part = partNamed(target, spec.replace(/=.*$/, ''));
            expect(part, `${name}: --field "${spec}" names a field of ${target}`).toBeDefined();
            expect(part && isEvidence(part), `${name}: "${spec}" is no attachment`).toBe(false);
          }
          // Run it as written, on an item of the board whose words it is in.
          at ??= await add(name);
          // A command that makes an item says the board's own fields are as "To add one" gives them.
          const given = new Set(field.map((spec) => spec.replace(/=.*$/, '')));
          const rest =
            command.sub === 'create'
              ? definitionOf(target).form.flatMap(({ ref }) => {
                  const part = definitionOf(target).parts[ref];
                  return part && !isEvidence(part) && !given.has(part.name) ? [part.name] : [];
                })
              : [];
          const argv = [
            command.sub,
            ...(command.sub === 'update' ? [at] : []),
            ...(command.sub === 'create' ? ['--title', 'Una parte'] : []),
            ...fieldArgs(target, rest),
            ...command.flags.flatMap(([flag, value]) =>
              flag === '--parent' ? [flag, at ?? ''] : [flag, value],
            ),
            '--json',
          ];
          const ran = await agent(...argv);
          expect(ran.err, `${name}: otea ${argv.join(' ')}`).toBe('');
        }
      }
    });
  });
});
