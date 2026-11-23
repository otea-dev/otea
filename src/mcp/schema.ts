import { type ZodType, z } from 'zod';
import type { Command, OptionSpec } from '../cli/command.ts';
import { RELATION_KINDS } from '../core/relations.ts';
import { NAMELESS_READS } from './commands.ts';

// What each tool takes, as the model reads it in tools/list: a type that says what the value is, and
// a description with the shape or an example. The CLI's placeholders ("id", "n") are not enough
// there (P8-F5).

// A tool's parameter is named after its option, with underscores: some harnesses map tools to
// functions of a language, or check names against [A-Za-z0-9_], and refuse a hyphen.
export const schemaKey = (name: string) => name.replaceAll('-', '_');

// The values a call gave, with each option under the name the command reads it by.
export function optionValues(
  command: Pick<Command, 'options'>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...values };
  for (const name of Object.keys(command.options)) {
    const key = schemaKey(name);
    if (key !== name && key in out) out[name] = out[key];
  }
  return out;
}

// Every word here is in every agent's context (src/cli/token-budget.test.ts): only what a name and a
// type do not say, in the fewest words.
const ARG_HELP: Readonly<Record<string, string>> = {
  id: 'item id, e.g. TASKS-1',
  other: 'item id',
  kind: RELATION_KINDS.join('|'),
  evidence: 'number from show',
  state: 'state name or id',
};

const OPTION_HELP: Readonly<Record<string, string>> = {
  field: '"name=value", one per field',
  module: 'evidence part: its name, its kind (log, images...) or id',
  ttl: 'duration: 90s, 15m, 1h',
  timeout: 'seconds, or 90s, 5m',
  parent: 'item id',
  item: 'item id',
  definition: 'board JSON, object or string',
  'all-projects': 'every project',
};

// A parameter's description: what the command says of it, else the table above, else its placeholder.
function helpFor(name: string, spec: OptionSpec): string | undefined {
  return spec.about ?? OPTION_HELP[name] ?? spec.placeholder;
}

// The values the CLI reads as numbers (a note's number, an event id) may come as a JSON number.
const NUMBERED = new Set(['n', 'event id']);

function optionSchema(name: string, spec: OptionSpec): ZodType {
  if (spec.flag) {
    const flag = z.boolean().optional();
    const said = helpFor(name, spec);
    return said ? flag.describe(said) : flag;
  }
  // A wait's timeout: a number of seconds, or a duration (90s, 5m).
  const durable = name === 'timeout';
  const numbered = NUMBERED.has(spec.placeholder ?? '') || durable;
  const text = numbered ? z.union([z.string(), z.number()]) : z.string();
  // The board JSON comes as an object too: no need to turn it into a string first.
  const json =
    name === 'definition' ? z.union([z.string(), z.record(z.string(), z.unknown())]) : text;
  const value = spec.choices ? z.enum(spec.choices as [string, ...string[]]) : json;
  const said = helpFor(name, spec);
  const described = said ? value.describe(said) : value;
  if (spec.multiple) return z.array(described).optional();
  return spec.required ? described : described.optional();
}

// Every tool takes the agent making the call, so subagents on one server stay apart. It is required
// where a call needs a name: on a server not started under one (otea mcp --as), for every tool but
// the ones that read without it (whoami, the topics).
function nameSchema(command: Command, named: boolean): ZodType {
  const described = z.string().describe('your agent name; each subagent its own');
  const needed = !named && command.name !== 'whoami' && !NAMELESS_READS.has(command.name);
  return needed ? described : described.optional();
}

export function inputSchema(
  command: Command,
  omitted: readonly string[],
  named: boolean,
): z.ZodObject<Record<string, ZodType>> {
  const shape: Record<string, ZodType> = { as: nameSchema(command, named) };
  for (const arg of command.args) {
    const optional = arg.endsWith('?');
    const key = optional ? arg.slice(0, -1) : arg;
    const help = ARG_HELP[key];
    const text = help ? z.string().describe(help) : z.string();
    shape[key] = optional ? text.optional() : text;
  }
  for (const [name, spec] of Object.entries(command.options)) {
    if (!omitted.includes(name)) shape[schemaKey(name)] = optionSchema(name, spec);
  }
  // Loose, not strict: a strict schema says additionalProperties:false in every tool, which every
  // agent pays for in its context. A key the tool does not take is refused by the call instead
  // (unknownParameters), never dropped silently.
  return z.looseObject(shape);
}

// The keys a call gave that the tool does not take. An option keeps taking the name it had before
// the hyphens became underscores (`all-projects`), so a client written for it still works.
export function unknownParameters(
  command: Pick<Command, 'args' | 'options'>,
  omitted: readonly string[],
  values: Record<string, unknown>,
): string[] {
  const known = new Set(['as', ...command.args.map((arg) => arg.replace(/\?$/, ''))]);
  for (const name of Object.keys(command.options)) {
    if (omitted.includes(name)) continue;
    known.add(name);
    known.add(schemaKey(name));
  }
  return Object.keys(values).filter((key) => !known.has(key));
}
