import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_GUIDE, agentGuideFor } from '../core/agent-guide.ts';
import { designPrompt, rolePrompt, startPrompt } from '../core/agent-prompts.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// The English desk says Talk, Inbox and Your turn (Hablar, Bandeja and Te toca are its Spanish
// names): what Otea tells an agent in English, the CLI's help, the role texts and the guide, says
// them so too. The command names stay (otea bandeja), and the Spanish texts say Hablar.
const SPANISH_NAMES = /\b(Bandeja|Hablar|Te toca|Te espera)\b/;

const found = (text: string) => text.match(new RegExp(SPANISH_NAMES, 'g')) ?? [];

describe('what Otea says to an agent in English', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;

  beforeEach(() => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'quill' });
  });

  afterEach(() => repo.remove());

  it('names Talk and the Inbox in the CLI help, and keeps the command names', async () => {
    const help = (await otea('help', 'all')).out;

    expect(found(help)).toEqual([]);
    expect(help).toContain('otea bandeja');
    expect(help).toContain('Inbox');
  });

  it('names them in the role texts and the guide', () => {
    const texts = [
      ...(['secretary', 'worker', 'refiner'] as const).map((role) =>
        rolePrompt(role, 'en', { board: 'Changes', name: 'ana' }),
      ),
      startPrompt('en'),
      designPrompt('en'),
      AGENT_GUIDE,
      agentGuideFor(true),
    ];

    for (const text of texts) expect(found(text)).toEqual([]);
  });

  it('keeps the Spanish names in the Spanish role texts', () => {
    expect(rolePrompt('secretary', 'es', {})).toContain('Hablar');
    expect(rolePrompt('secretary', 'es', {})).toContain('Bandeja');
  });

  it('names them in what the commands answer', async () => {
    await otea('init', '--local', '--template', 'none');

    const empty = await otea('bandeja');
    const missing = await otea('bandeja', 'B-9');
    const told = await otea('escalate', 'B-9', 'a problem');

    for (const result of [empty, missing, told]) {
      expect(found(`${result.out}\n${result.err}`), result.err).toEqual([]);
    }
    expect(empty.out).toContain('The Inbox is empty');
  });
});
