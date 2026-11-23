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
