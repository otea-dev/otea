import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../cli/commands.ts';
import { mcpWords } from './words.ts';

const words = (text: string) => mcpWords(text, COMMANDS);

// Over MCP an agent calls tools, not commands: what Otea tells it names the tool and its arguments.
describe('mcpWords', () => {
  it('names a command line as the tool call it is', () => {
    expect(words('Wait for one: otea wait --turn agent --unclaimed, then otea next.')).toBe(
      'Wait for one: wait { turn: "agent", unclaimed: true }, then next.',
    );
    expect(words('Claim it first: otea claim CRI-1 (otea next --claim takes it).')).toBe(
      'Claim it first: claim { id: "CRI-1" } (next { claim: true } takes it).',
    );
    expect(words('  otea handoff CRI-1 --way "Triar" --reason "why"')).toBe(
      '  handoff { id: "CRI-1", way: "Triar", reason: "why" }',
    );
    expect(words('otea board draft --new "Ideas" --why "<why>"')).toBe(
      'board_draft { new: "Ideas", why: "<why>" }',
    );
  });

  it('keeps a shell line as it is: an MCP agent runs it in its shell', () => {
    expect(words('In a background shell: $ otea wait --turn agent --unclaimed --as kiln')).toBe(
      'In a background shell: $ otea wait --turn agent --unclaimed --as kiln',
    );
  });

  it('names an option on its own as the argument', () => {
    expect(words('Not taken back: say why with --reason.')).toBe(
      'Not taken back: say why with { reason }.',
    );
    expect(words('Call handoff again with --note "<la prueba>".')).toBe(
      'Call handoff again with { note: "<la prueba>" }.',
    );
    expect(words('Attach or fill them with otea attach BUG-1 / otea update BUG-1, then')).toBe(
      'Attach or fill them with attach { id: "BUG-1" } / update { id: "BUG-1" }, then',
    );
    expect(words('--timeout must be at most 15m over MCP')).toBe(
      '{ timeout } must be at most 15m over MCP',
    );
  });

  it('never reads the prose after a command as its item', () => {
    expect(words('Si dudas, pregunta con otea ask antes de seguir.')).toBe(
      'Si dudas, pregunta con ask antes de seguir.',
    );
    expect(words('Read it: otea show <id>, then otea board tasks.')).toBe(
      'Read it: show { id: "<id>" }, then board { name: "tasks" }.',
    );
  });

  // P8-F1: the agent runs git's commands as they are; only Otea's own options become arguments.
  it('never rewrites the flags of another tool', () => {
    for (const text of [
      'push Branch first (git push --force-with-lease origin <branch>), then main',
      'Write the short hash (git rev-parse --short main).',
      'push it yourself this once with git push --force-with-lease --no-verify, which skips the check',
      'open one and merge it with gh pr merge --squash --delete-branch',
    ])
      expect(words(text)).toBe(text);
    // Beside an Otea command, the Otea flag still reads as its argument.
    expect(words('push it (git push --force-with-lease origin x), then otea next --claim.')).toBe(
      'push it (git push --force-with-lease origin x), then next { claim: true }.',
    );
  });

  // The flags below are names of Otea options too (check, all, since, limit): the same flag in
  // prose reads as an argument (the control), and in another tool's command line, whichever the
  // tool, it is left alone. Removing the check turns every one of these red.
  describe('a command line that is not Otea’s', () => {
    const others = [
      '`cargo fmt --check`',
      '`docker ps --all`',
      '`uv run ruff format --check`',
      '`git log --since "2 days ago"`',
      '`gh pr list --limit 5`',
      '`kubectl get pods --all`',
      '$ make lint --check',
      '  $ git log --since "2 days ago"',
    ];

    it('knows those flags as Otea options', () => {
      expect(words('with --check')).toBe('with { check }');
      expect(words('with --all')).toBe('with { all }');
      expect(words('with --since "5m"')).toBe('with { since: "5m" }');
      expect(words('with --limit "5"')).toBe('with { limit: "5" }');
    });

    it('leaves the flags of a backtick span, a $ line and a fenced line as they are', () => {
      for (const line of others) {
        const text = line.startsWith('`') ? `Run it: ${line} before you hand it off.` : line;
        expect(words(text)).toBe(text);
      }
      const fenced = 'Run:\n```\ncargo fmt --check\ndocker ps --all\n```\nthen pass --check.';
      expect(words(fenced)).toBe(
        'Run:\n```\ncargo fmt --check\ndocker ps --all\n```\nthen pass { check }.',
      );
    });

    it('still reads the flag of the prose around it, and of a span that holds only a flag', () => {
      expect(words('Run `cargo fmt --check`, then pass --check.')).toBe(
        'Run `cargo fmt --check`, then pass { check }.',
      );
      expect(words('Say why with `--reason`, not `git log --since "1 day ago"`.')).toBe(
        'Say why with `{ reason }`, not `git log --since "1 day ago"`.',
      );
      expect(words('Name it with `--as <name>`.')).toBe('Name it with `{ as: <name> }`.');
    });

    it('does not take a word like node or git in prose for a command line', () => {
      expect(words('Give the node name with --as <name>')).toBe(
        'Give the node name with { as: <name> }',
      );
      expect(words('Check the git history first, then pass --check.')).toBe(
        'Check the git history first, then pass { check }.',
      );
      expect(words('Pon el nombre del nodo con --as <nombre>, luego git log y --check')).toBe(
        'Pon el nombre del nodo con { as: <nombre> }, luego git log y { check }',
      );
    });

    it('reads a step written in Spanish the same way', () => {
      const step =
        'Revisa los cambios con `git log --since "2 days ago"` y con `cargo fmt --check`; después usa --as <nombre> y otea next --claim.';
      expect(words(step)).toBe(
        'Revisa los cambios con `git log --since "2 days ago"` y con `cargo fmt --check`; después usa { as: <nombre> } y next { claim: true }.',
      );
    });
  });

  // A tool call has no --field-file (the tool omits it), so the words do not make it a parameter.
  it('leaves an option the tool does not take as it is', () => {
    expect(words('Nothing to update; pass --title, --description, --field or --field-file')).toBe(
      'Nothing to update; pass { title }, { description }, { field } or --field-file',
    );
    expect(words('otea update CAM-1 --field-file "What=notes.md"')).not.toContain('field_file');
  });

  // P8-F3: a repeated option is one array argument, as the tool's schema asks.
  it('names a repeated option as an array, one value or several', () => {
    expect(words('Fill it with otea update CAM-1 --field "Branch=<branch>".')).toBe(
      'Fill it with update { id: "CAM-1", field: ["Branch=<branch>"] }.',
    );
    expect(words('otea update CAM-1 --field "Effort=Small" --field "Impact=low"')).toBe(
      'update { id: "CAM-1", field: ["Effort=Small", "Impact=low"] }',
    );
    expect(words('set it with --field "Effort=Small"')).toBe(
      'set it with { field: ["Effort=Small"] }',
    );
  });

  // P8-F2: a JSON text is data to hand back as it is, never prose to rewrite.
  it('leaves a JSON text as it is', () => {
    const json = JSON.stringify({ step: 'run otea handoff <id> --way "Do it" --reason "why"' });
    expect(words(json)).toBe(json);
    expect(words(`${json}\n`)).toBe(`${json}\n`);
  });

  it('leaves a command the server does not serve as the person would run it', () => {
    expect(words('Ask the person to run otea init --agents-md.')).toBe(
      'Ask the person to run otea init --agents-md.',
    );
  });
});
