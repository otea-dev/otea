import { type CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Harness } from '../app/presence.ts';
import { NO_TAILSCALE } from '../app/tailscale.ts';
import { type Command, errorData, type Input, UsageError } from '../cli/command.ts';
import { NO_FORGE } from '../cli/forge.ts';
import { OTEA_VERSION } from '../cli/version.ts';
import { agentGuideFor } from '../core/agent-guide.ts';
import { OteaError } from '../core/errors.ts';
import { type Actor, agentActor, assertAgentName, PERSON_READER } from '../core/item.ts';
import { parseWaitTimeout } from '../core/lease.ts';
import {
  AGENT_COMMANDS,
  NAMELESS_READS,
  OMITTED_OPTIONS,
  READ_ONLY,
  toolName,
} from './commands.ts';
import { inputSchema, optionValues, unknownParameters } from './schema.ts';
import { mcpWords } from './words.ts';

export { AGENT_COMMANDS, CLI_ONLY_COMMANDS, OMITTED_OPTIONS, toolName } from './commands.ts';

// Clients time out long tool calls, so a wait gives up after this unless told otherwise, and never
// waits longer than the cap.
const WAIT_TIMEOUT = '5m';
const WAIT_MAX = { text: '15m', ms: 15 * 60_000 };

const NOTES: Readonly<Record<string, string>> = {
  attach:
    'file is a path on this machine, which the server reads; a relative one is resolved against the directory otea mcp runs in. module: the name show lists, or the kind (log, images).',
  'board draft':
    'Hand the board JSON in as definition (an object or a string): a tool call has no stdin to pipe it on, and no file is needed. file is a path on this machine, resolved against the directory otea mcp runs in. Pass id, new or change: one of them.',
  events:
    'Returns the events after the event id given to since, one a line with its id first; call it again with the last id to read newer ones.',
  wait: `Gives up after timeout (default ${WAIT_TIMEOUT}, at most ${WAIT_MAX.text}) with a result, not an error, that says nothing arrived; call it again to keep waiting.`,
};

// `agent`: the name the server was started as (otea mcp --as), which a call that names nobody acts
// as. Subagents share their parent's server, so every call can name its own agent with `as`, which
// wins; a call that names nobody on a server started without a name is refused.
// `greeted` hears the client's name once it has introduced itself, so the agent shows up as seen
// before its first call.
export type McpContext = {
  cwd: string;
  // Results as the data otea --json prints (otea mcp --json), for a program that reads them; else
  // as the text the CLI prints, which is what an agent reads, at a fraction of the tokens.
  json?: boolean;
  // The project the agent is pinned to (otea connect's OTEA_PROJECT_ID): writes elsewhere refused.
  pin?: string;
  agent?: string;
  // Whether the project keeps side topics: the guide then tells agents to record them.
  topics?: boolean;
  warn(message: string): void;
  greeted?(harness: Harness | undefined): void;
  // An agent called a tool: the server, open, keeps it heard as listening (otea mcp beats it).
  heard?(agent: string): void;
  // An agent calls again: refused once another session took its name (claimName).
  still?(agent: string): void;
  // An agent ran whoami: the explicit way a session says what it is called now, which is how a
  // rename mid-session is told (never guessed from the names of its calls, and not from profile:
  // every subagent declares one).
  rebound?(agent: string): void;
  // An agent's first call on this server failed: the server forgets it, unless it is known.
  failed?(agent: string): void;
  // A tool call begins; what it returns is called as the call ends.
  calling?(command: string): () => void;
};

type Values = Record<string, unknown>;

// A record a command printed one by one (events): its data and its text.
type Printed = { data: unknown; text: string };

const NAME_YOURSELF = 'pass as with your agent name on every call';

// A server started under a name (otea mcp --as) is that agent's: a call names it, or one of its
// subagents (<name>-<role>), never another agent, which would spread one agent over several names.
export function assertPinnedName(pinned: string | undefined, agent: string | undefined): void {
  if (pinned === undefined || agent === undefined) return;
  assertAgentName(agent);
  if (agent === pinned || agent.startsWith(`${pinned}-`)) return;
  throw new OteaError(
    'forbidden',
    `This MCP server is ${pinned}'s (otea mcp --as ${pinned}): call as ${pinned}, or as ${pinned}-<role> for a subagent; nothing was done as ${agent}`,
  );
}

function waitValues(values: Values): Values {
  const given = values.timeout;
  // A bare number is seconds, as on the command line.
  const timeout =
    typeof given === 'string' || typeof given === 'number' ? String(given) : WAIT_TIMEOUT;
  const ms = parseWaitTimeout(timeout);
  if (ms !== undefined && ms > WAIT_MAX.ms) {
    throw new UsageError(`--timeout must be at most ${WAIT_MAX.text} over MCP`);
  }
  return { ...values, timeout };
}

// The tool call as the command's input: the same arguments and options the CLI would parse.
function inputFor(
  command: Command,
  values: Values,
  context: McpContext,
  signal: AbortSignal,
  records: Printed[],
  harness: Harness | undefined,
  seen: Set<string>,
): Input {
  const option = (name: string) => {
    const value = values[name];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    // The board JSON, given as an object, as the JSON it is.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return JSON.stringify(value);
    }
    return undefined;
  };
  const agent = typeof values.as === 'string' && values.as !== '' ? values.as : context.agent;
  // A name the CLI refuses is refused before the server hears it, so it never shows as an agent.
  if (agent !== undefined) assertAgentName(agent);
  assertPinnedName(context.agent, agent);
  // The first call of each agent on this server starts its session here.
  const newSession = agent !== undefined && !seen.has(agent);
  if (agent !== undefined) {
    if (newSession) context.heard?.(agent);
    else context.still?.(agent);
    seen.add(agent);
    // Only whoami is a session naming itself. A subagent declares its profile under its own name
    // (guide rule 2), which says nothing of what the session is called.
    if (command.name === 'whoami') context.rebound?.(agent);
  }
  return {
    cwd: context.cwd,
    ...(context.pin === undefined ? {} : { pin: context.pin }),
    get actor(): Actor {
      return agentActor(agent, NAME_YOURSELF);
    },
    // Over MCP the caller is always an agent: reading needs its name too, but for the topics.
    get reader(): Actor {
      if (agent === undefined && NAMELESS_READS.has(command.name)) return PERSON_READER;
      return agentActor(agent, NAME_YOURSELF);
    },
    agent,
    channel: 'mcp',
    command: command.name,
    harness,
    ...(newSession ? { newSession } : {}),
    ...(context.json ? {} : { fieldsAsJson: true }),
    signal,
    openUrl: async () => {
      throw new Error('No browser to open over MCP');
    },
    tailscale: NO_TAILSCALE,
    forge: NO_FORGE,
    probe: async () => false,
    terminal: false,
    warn: context.warn,
    ask: async () => undefined,
    stdin: async () => '',
    print: (data, text) => records.push({ data, text }),
    args: command.args.flatMap((name) => {
      const key = name.endsWith('?') ? name.slice(0, -1) : name;
      const value = values[key];
      return value === undefined && key !== name ? [] : [String(value ?? '')];
    }),
    flag: (name) => values[name] === true,
    option,
    options: (name) => {
      const value = values[name];
      return Array.isArray(value) ? value.map(String) : [];
    },
    required: (name) => {
      const value = option(name);
      if (value === undefined) throw new UsageError(`Missing --${name} for "otea ${command.name}"`);
      return value;
    },
  };
}

function reply(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

// Runs the command as the CLI would: the text it prints, in the words of the tools, as the only
// content (no structuredContent, which some clients put in context next to it, so the item's fields
// would cost twice: show and next give them as one JSON object line in the text instead); a
// failure, its message. Under otea mcp --json: its data, or the records it printed one by one, and
// a failure as the same {"error":{"code","message"}} the CLI prints. A wait that gave up is no
// failure: nothing arrived.
async function callCommand(
  command: Command,
  values: Values,
  context: McpContext,
  signal: AbortSignal,
  harness: Harness | undefined,
  seen: Set<string>,
  commands: readonly Command[],
): Promise<CallToolResult> {
  const records: Printed[] = [];
  let input: Input | undefined;
  const done = context.calling?.(command.name);
  try {
    const unknown = unknownParameters(command, OMITTED_OPTIONS[command.name] ?? [], values);
    if (unknown.length > 0) {
      throw new UsageError(
        `${toolName(command.name)} takes no ${unknown.map((key) => `{ ${key} }`).join(', ')}: see its input schema (an option with a hyphen is named with an underscore, such as all_projects)`,
      );
    }
    const named = optionValues(command, values);
    const given = command.name === 'wait' ? waitValues(named) : named;
    input = inputFor(command, given, context, signal, records, harness, seen);
    const output = await command.execute(input);
    if (context.json) {
      const data =
        output === undefined ? records.map(({ data }) => data) : inMcpWords(output.data, commands);
      return reply(JSON.stringify(data), false);
    }
    const text = output === undefined ? records.map(({ text }) => text).join('\n') : output.text;
    // A command with nothing to say (no events yet) still answers: with its data.
    if (text === '') return reply(JSON.stringify(output === undefined ? [] : output.data), false);
    return reply(mcpWords(text, commands), false);
  } catch (error) {
    // A first call that failed starts no session: the next call is its first again (P2S-R2-3).
    if (input?.newSession && input.agent !== undefined) {
      seen.delete(input.agent);
      context.failed?.(input.agent);
    }
    const { error: data } = errorData(error);
    const message =
      typeof data.message === 'string' ? mcpWords(data.message, commands) : data.message;
    // A wait that timed out found nothing: a result that says so, which the agent answers by
    // waiting again, not an error (the CLI's exit 13 stays: a shell tells it by the code).
    if (command.name === 'wait' && data.code === 'timeout') {
      const said = String(message);
      return reply(
        context.json
          ? JSON.stringify({ timedOut: true, message: said })
          : `Nothing arrived (this is not an error): ${said}`,
        false,
      );
    }
    if (!context.json) return reply(String(message), true);
    return reply(JSON.stringify({ error: { ...data, message } }), true);
  } finally {
    done?.();
  }
}

// What a command says to the agent (its `text`, show's `hint`: what to do with the item now, and
// wait's topics `reminder`), in the words of the tools it calls.
const SAID = ['text', 'hint', 'reminder'] as const;

function inMcpWords(data: unknown, commands: readonly Command[]): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const said = data as Record<string, unknown>;
  const words = SAID.flatMap((key) => {
    const value = said[key];
    return typeof value === 'string' ? [[key, mcpWords(value, commands)]] : [];
  });
  return words.length === 0 ? data : { ...data, ...Object.fromEntries(words) };
}

export function createMcpServer(commands: readonly Command[], context: McpContext): McpServer {
  // Otea's agent guide as the server's instructions: clients such as Claude Code put them in the
  // agent's context when it connects.
  // In the words of the tools it serves: `next { claim: true }`, not `otea next --claim`, which no
  // client of this server can run (the board tool gives the same guide the same way, P8-F4).
  const server = new McpServer(
    { name: 'otea', version: OTEA_VERSION },
    { instructions: mcpWords(agentGuideFor(context.topics ?? false), commands) },
  );
  // The client names itself in initialize: its clientInfo is the harness the agent works through.
  const harness = (): Harness | undefined => {
    const client = server.server.getClientVersion();
    return client && { name: client.name, version: client.version };
  };
  // The agents that called this server so far: each one's first call starts its session.
  const seen = new Set<string>();
  server.server.oninitialized = () => context.greeted?.(harness());
  for (const name of AGENT_COMMANDS) {
    const command = commands.find((candidate) => candidate.name === name);
    if (!command) throw new Error(`No "otea ${name}" command to serve`);
    const note = NOTES[name];
    server.registerTool(
      toolName(name),
      {
        // The command's own words speak of flags (--way, --note): here they are parameters.
        description: mcpWords(note ? `${command.summary}. ${note}` : command.summary, commands),
        inputSchema: inputSchema(
          command,
          OMITTED_OPTIONS[command.name] ?? [],
          context.agent !== undefined,
        ),
        annotations: { readOnlyHint: READ_ONLY.has(name) },
      },
      (values: Values, { mcpReq }) =>
        callCommand(command, values, context, mcpReq.signal, harness(), seen, commands),
    );
  }
  return server;
}

// Serves on stdin and stdout until the client closes stdin, which the transport notices, or the
// signal aborts. Stdout carries the protocol alone.
export async function serveStdio(server: McpServer, signal: AbortSignal): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  const close = () => void server.close();
  signal.addEventListener('abort', close, { once: true });
  await server.connect(new StdioServerTransport());
  await closed;
}
