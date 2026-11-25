import type { Command, OptionSpec } from '../cli/command.ts';
import { AGENT_COMMANDS, NO_PARAMETER, parameterName, toolName } from './commands.ts';

// A token of a command line: a quoted value, or a run up to a space or the punctuation that ends a
// sentence or a parenthesis.
const TOKEN = /^(?:"[^"]*"|[^\s,;)`]+?)(?=[\s,;)`]|[.:](?:\s|$)|$)/;

// The arguments that name an item, and what can stand for one in a text.
const ITEM_ARGS = new Set(['id', 'ids...']);
const ITEM_VALUE = /^(?:"[^"]*"|<[^>]+>|[A-Z][A-Z0-9]*-\d+)$/;

function isJson(text: string): boolean {
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const quoted = (value: string) =>
  value.startsWith('"') ? value : JSON.stringify(value.replace(/\.$/, ''));

// One command line at `text[start]` (just after "otea "), as the tool call it is: its arguments in
// order, then its options, a flag as true. Undefined when it names no command the server serves.
function call(
  text: string,
  start: number,
  commands: readonly Command[],
): { said: string; end: number } | undefined {
  const name = [...AGENT_COMMANDS]
    .sort((a, b) => b.length - a.length)
    .find(
      (candidate) =>
        text.startsWith(candidate, start) &&
        /^(\s|$|[,.;:)`])/.test(text.slice(start + candidate.length)),
    );
  const command = name && commands.find((candidate) => candidate.name === name);
  if (!name || !command) return undefined;
  let at = start + name.length;
  const args = command.args.map((arg) => arg.replace(/\?$/, ''));
  const pairs: string[] = [];
  // A repeated option (--field a --field b) is one argument holding an array, as the tool asks.
  const many = new Map<string, { at: number; values: string[] }>();
  const list = (key: string, value: string) => {
    const entry = many.get(key) ?? { at: pairs.push(''), values: [] };
    many.set(key, entry);
    entry.values.push(value);
    pairs[entry.at - 1] = `${key}: [${entry.values.join(', ')}]`;
  };
  for (;;) {
    const rest = text.slice(at);
    const space = rest.match(/^ +/)?.[0] ?? '';
    const token = rest.slice(space.length).match(TOKEN)?.[0];
    if (!space || !token || token === '/') break;
    if (token.startsWith('--')) {
      const option = token.slice(2);
      const spec = command.options[option];
      if (!spec || NO_PARAMETER.has(option)) break;
      at += space.length + token.length;
      // A tool's parameter has underscores where the option has hyphens (all-projects).
      const key = parameterName(name, option);
      if (spec.flag) {
        pairs.push(`${key}: true`);
        continue;
      }
      const after = text.slice(at);
      const gap = after.match(/^ +/)?.[0] ?? '';
      const value = after.slice(gap.length).match(TOKEN)?.[0];
      if (!gap || !value || value.startsWith('--')) {
        pairs.push(key);
        continue;
      }
      at += gap.length + value.length;
      if (spec.multiple) list(key, quoted(value));
      else pairs.push(`${key}: ${quoted(value)}`);
      continue;
    }
    const arg = args[0];
    if (arg === undefined) break;
    // An item is named by its id, quoted or a placeholder: a word after the command is prose
    // ("pregunta con otea ask antes de seguir").
    if (ITEM_ARGS.has(arg) && !ITEM_VALUE.test(token)) break;
    args.shift();
    at += space.length + token.length;
    pairs.push(`${arg}: ${quoted(token)}`);
  }
  const tool = toolName(name);
  return { said: pairs.length > 0 ? `${tool} { ${pairs.join(', ')} }` : tool, end: at };
}

// Whether `at` is inside the command line of a tool other than Otea (`cargo fmt --check`, `git log
// --since "2 days ago"`): its flags are its own, whatever Otea calls an option the same. A command
// line is a backtick span, a `$` line or a line of a fenced block; one that starts with otea is
// Otea's. A flag in prose, or alone in a span (`--reason`), is not in a command line.
function otherToolsLine(text: string, at: number): boolean {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const before = text.slice(lineStart, at);
  const fenced = (text.slice(0, lineStart).match(/^[ \t]*```/gm) ?? []).length % 2 === 1;
  let line: string | undefined;
  if (fenced) line = before;
  else if (/^\s*\$ /.test(before)) line = before.replace(/^\s*\$ /, '');
  else if ((before.match(/`/g) ?? []).length % 2 === 1)
    line = before.slice(before.lastIndexOf('`') + 1);
  const first = line?.trim().replace(/^\$ /, '').split(/\s+/)[0];
  return first !== undefined && /^[a-z][\w./-]*$/i.test(first) && first !== 'otea';
}

// What Otea tells an agent, in the words of the MCP tools it calls: `otea wait --turn agent`
// reads `wait { turn: "agent" }`, an option on its own (`--reason`) reads `{ reason }`. A command
// the server does not serve, and the flags of another tool's command (git's), are left as they are.
// A JSON text is data, not prose: it stays as it is.
export function mcpWords(text: string, commands: readonly Command[]): string {
  if (isJson(text)) return text;
  const options = new Map<string, OptionSpec>([['as', {}]]);
  for (const command of commands) {
    for (const [name, spec] of Object.entries(command.options)) {
      if (NO_PARAMETER.has(name)) continue;
      options.set(name, {
        ...options.get(name),
        ...spec,
        multiple: spec.multiple === true || options.get(name)?.multiple === true,
      });
    }
  }
  let out = '';
  let at = 0;
  while (at < text.length) {
    if (text.startsWith('otea ', at) && (at === 0 || /[\s(`"']/.test(text[at - 1] ?? ''))) {
      // A shell line ("$ otea wait …"), which an MCP agent runs in its shell, is kept as it is.
      const shell = text.slice(Math.max(0, at - 2), at) === '$ ';
      const told = shell ? undefined : call(text, at + 'otea '.length, commands);
      if (told) {
        out += told.said;
        at = told.end;
        continue;
      }
      // A command line the server does not serve, kept whole up to where it ends.
      const line = text.slice(at).match(/^otea [^,;)`]*?(?=[,;)`]|[.:](?:\s|$)|$)/)?.[0] ?? 'otea ';
      out += line;
      at += line.length;
      continue;
    }
    // A placeholder after it (`--as <name>`) is the value: `{ as: <name> }`.
    const option = text.slice(at).match(/^--([a-z][a-z0-9-]*)(?: ("[^"]*"|<[^>\s]+>))?/);
    const known = option?.[1] === undefined ? undefined : options.get(option[1]);
    if (
      option &&
      known &&
      (at === 0 || /[\s(`"']/.test(text[at - 1] ?? '')) &&
      !otherToolsLine(text, at)
    ) {
      const key = (option[1] ?? '').replaceAll('-', '_');
      const value =
        option[2] === undefined || known.multiple !== true ? option[2] : `[${option[2]}]`;
      out += value === undefined ? `{ ${key} }` : `{ ${key}: ${value} }`;
      at += option[0].length;
      continue;
    }
    out += text[at];
    at += 1;
  }
  // The guide names the tool beside each command ("(MCP: ask)", "(MCP tools: as)"): here that is
  // the text itself.
  return out.replace(/ \(MCP(?: tools)?: [a-z_]+\)/g, '');
}
