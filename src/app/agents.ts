import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OteaError } from '../core/errors.ts';
import type { Launcher } from './launcher.ts';

const BEGIN = '<!-- otea:begin -->';
const END = '<!-- otea:end -->';

// The marked block `otea init --agents-md` and `otea connect` keep in the project's AGENTS.md: it
// says where Otea's agent guide is, and holds no copy of it. Each agent then reads the guide once,
// as it stands now (agentGuideFor): an MCP agent in the server's instructions, any other in otea
// board, which a copy here would only repeat, and which went stale (MCP-TOKENS). Only the text
// between the markers is Otea's.
export const AGENTS_BLOCK = [
  BEGIN,
  '## Otea',
  '',
  "This project hands work between people and agents through Otea. Follow Otea's agent guide to the letter. Over MCP it is the Otea server's instructions. On the command line, or when your client shows no instructions, read it first with `otea board` (MCP: the `board` tool with no name), which also lists the boards. Then `otea next` gives the item to take and what its step asks.",
  END,
].join('\n');

export type AgentsMdAction = 'created' | 'added' | 'updated' | 'unchanged';

export type AgentsMdResult = { path: string; action: AgentsMdAction };

// Whether the file's lines end in CRLF (Windows checks AGENTS.md out that way with
// core.autocrlf=true): the block then follows, so it is never written in two endings.
const usesCrlf = (text: string) =>
  (text.match(/\r\n/g) ?? []).length > (text.match(/(?<!\r)\n/g) ?? []).length;

function withBlock(current: string): string {
  const eol = usesCrlf(current) ? '\r\n' : '\n';
  const block = AGENTS_BLOCK.replaceAll('\n', eol);
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END, begin);
  if (begin >= 0 && end >= 0) {
    return `${current.slice(0, begin)}${block}${current.slice(end + END.length)}`;
  }
  const separator = current.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${current}${separator}${block}${eol}`;
}

// Adds the block to AGENTS.md at the project root, or replaces the one already there: running it
// again never adds a second block.
export function writeAgentsMd(root: string): AgentsMdResult {
  const path = join(root, 'AGENTS.md');
  if (!existsSync(path)) {
    writeFileSync(path, `${AGENTS_BLOCK}\n`);
    return { path, action: 'created' };
  }
  const current = readFileSync(path, 'utf8');
  const next = withBlock(current);
  if (next === current) return { path, action: 'unchanged' };
  writeFileSync(path, next);
  return { path, action: current.includes(BEGIN) ? 'updated' : 'added' };
}

export type AgentsMdRemoval =
  | { path: string; action: 'removed' | 'deleted' | 'absent' }
  // Markers that are not one block exactly as Otea writes it: the file is left whole.
  | { path: string; action: 'refused'; reason: string };

function occurrences(text: string, word: string): number[] {
  const at: number[] = [];
  for (let from = text.indexOf(word); from >= 0; from = text.indexOf(word, from + word.length)) {
    at.push(from);
  }
  return at;
}

// Takes Otea's block out of AGENTS.md at the project root, with the blank line writeAgentsMd put
// before it, and deletes the file when nothing else is left (Otea made it). Only a block that is
// exactly the one Otea writes (a CRLF file's too) goes: one begin and one end marker, in that order,
// with the text between them what Otea wrote. Anything else (a marker twice, one alone, a line of
// the person's inside the block) is refused, and the file is left as it is: text outside the
// markers is never touched, and never crossed. `dryRun` says what would happen and writes nothing.
export function removeAgentsMd(root: string, dryRun = false): AgentsMdRemoval {
  const path = join(root, 'AGENTS.md');
  if (!existsSync(path)) return { path, action: 'absent' };
  // The file the block is in: the target of a link, which is written, never the link itself.
  const linked = lstatSync(path).isSymbolicLink();
  const real = linked ? realpathSync(path) : path;
  const current = readFileSync(real, 'utf8');
  const begins = occurrences(current, BEGIN);
  const ends = occurrences(current, END);
  if (begins.length === 0 && ends.length === 0) return { path, action: 'absent' };
  const [begin] = begins;
  const [end] = ends;
  if (begins.length !== 1 || ends.length !== 1 || begin === undefined || end === undefined) {
    return {
      path,
      action: 'refused',
      reason: `its ${BEGIN} and ${END} markers are not one pair (one is missing or repeated); remove Otea's block by hand`,
    };
  }
  if (end < begin) {
    return {
      path,
      action: 'refused',
      reason: `its ${END} marker comes before ${BEGIN}; remove Otea's block by hand`,
    };
  }
  const block = current.slice(begin, end + END.length);
  if (block.replace(/\r\n/g, '\n') !== AGENTS_BLOCK) {
    return {
      path,
      action: 'refused',
      reason: `the text between its markers is not what Otea writes (it was edited, or is from an older Otea); remove Otea's block by hand`,
    };
  }
  let before = current.slice(0, begin);
  let after = current.slice(end + END.length).replace(/^\r?\n/, '');
  // The block went at the end after a blank line: take that line with it. In the middle, between
  // two blank lines, they become one.
  if (after === '') before = before.replace(/(\r?\n)\r?\n$/, '$1');
  else if (/\n\r?\n$/.test(before) && /^\r?\n/.test(after)) after = after.replace(/^\r?\n/, '');
  const next = `${before}${after}`;
  const empty = next.trim() === '';
  // A link is never removed, and a file it points to is never deleted: with the block gone from
  // the target there would be nothing left, so both stay and the person is told.
  if (empty && linked) {
    return {
      path,
      action: 'refused',
      reason: `it is a link to ${real} and nothing but Otea's block is in it, so Otea leaves both; delete them yourself if you want them gone`,
    };
  }
  if (!dryRun) {
    if (empty) rmSync(path);
    else writeFileSync(real, next);
  }
  return { path, action: empty ? 'deleted' : 'removed' };
}

export const MCP_SERVER = 'otea';

export type McpEntry = { command: string; args: string[]; env?: Record<string, string> };

// The project an agent is pinned to: `otea mcp --project <id>`, or this variable in the
// environment of its shell or MCP server.
export const PIN_ENV = 'OTEA_PROJECT_ID';

// A write by an agent pinned to another project than the one its folder resolves to: refused.
export function assertPinned(pin: string | undefined, project: { id: string; name: string }) {
  if (pin === undefined || pin === project.id) return;
  throw new OteaError(
    'forbidden',
    `This agent is pinned to the project ${pin} (otea mcp --project, or ${PIN_ENV}), but this folder is the project ${project.name} (${project.id}); nothing was written. Work from a folder of ${pin}, or point the agent's MCP server at ${project.id}`,
  );
}

// The MCP server an agent adds to its own harness's config (Otea writes none: it works with any
// harness, and each keeps its config its own way): named otea, it runs this Otea's `mcp` for the
// project `project`, pinned to it, so a server started from another project's folder refuses to
// write there. It names no agent: every session names itself, so two terminals never share a name.
export function mcpEntry(launcher: Launcher, project: string): McpEntry {
  return {
    command: launcher.command,
    args: [...launcher.args, 'mcp', '--project', project],
    ...(launcher.env && Object.keys(launcher.env).length > 0 ? { env: { ...launcher.env } } : {}),
  };
}

// The otea entry an older `otea connect` wrote in the project's .mcp.json, which named one agent
// for every session started there; undefined when there is none.
export function oldMcpEntry(root: string): string | undefined {
  const path = join(root, '.mcp.json');
  if (!existsSync(path)) return undefined;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      mcpServers?: Record<string, { args?: unknown }>;
    };
    const args = config.mcpServers?.[MCP_SERVER]?.args;
    return Array.isArray(args) && args.includes('--as') ? path : undefined;
  } catch {
    return undefined;
  }
}
