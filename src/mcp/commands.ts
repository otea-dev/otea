// Which commands MCP serves as tools, and the tools' names: no dependencies, so the CLI's help
// reads them without loading the MCP server.
// The commands an agent runs, each served as the tool of the same name. The rest belong to the
// human or to setup and stay in the CLI.
export const AGENT_COMMANDS = [
  'board',
  'board draft',
  'list',
  'show',
  'create',
  'update',
  'attach',
  'detach',
  'link',
  'unlink',
  'next',
  'reply',
  'merged',
  'reopen',
  'tick',
  'topic add',
  'topic answer',
  // Agents read the topics kept to answer what was said before.
  'topic list',
  'topic show',
  'ask',
  // The person's answer to a question, given in the chat (P4-R2-2).
  'answer',
  'handoff',
  'drop',
  'approve',
  'send-back',
  'move',
  'claim',
  'profile',
  'whoami',
  'heartbeat',
  'release',
  'relay',
  'events',
  'wait',
] as const;

export const CLI_ONLY_COMMANDS = [
  'init',
  // The person's first minutes in one command: it starts the desk, which an agent never does.
  'start',
  'brief',
  // How each model performs is the person's reading, not an agent's.
  'stats',
  'projects list',
  'projects current',
  'projects add',
  'projects relink',
  'projects forget',
  // A repo's name decides which items a gate checks, so agents never set it.
  'repos list',
  'repos add',
  'repos remove',
  'migrate',
  'connect',
  'board add',
  // What the person pastes into an agent's chat: the person copies it, the agent never needs it.
  'prompt',
  // A cut-out image is a file on the agent's own disk, which only the command line can hand it.
  'crop',
  // Topics are the person's to turn on, keep going and close; agents record, answer and read them.
  'topic on',
  'topic off',
  'topic note',
  'topic close',
  'collection icon',
  'validate',
  'check',
  'hook install',
  'hook remove',
  'uninstall',
  'serve',
  'serve start',
  'serve stop',
  'serve status',
  'open',
  'devices list',
  'devices revoke',
  'phone status',
  'phone lan',
  'phone tailscale',
  'phone relay',
  'mcp',
];

// next is not among them: it keeps what it offers each agent, and claims it with claim.
export const READ_ONLY = new Set([
  'board',
  'list',
  'show',
  'events',
  'wait',
  'topic list',
  'topic show',
  'whoami',
]);

// Reads that need no name: what was concluded before is reference, not work an agent does, so a
// call that names nobody reads it, and nobody is seen.
export const NAMELESS_READS = new Set(['topic list', 'topic show']);

// The options of a command its tool does not take. A tool call answers once, so it cannot follow
// the event log; --field-file reads a file or stdin for a long value, which a tool call carries as
// it is.
export const OMITTED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  events: ['follow'],
  // An MCP client names its own harness.
  next: ['harness'],
  create: ['field-file'],
  update: ['field-file'],
};

// Options whose mention in a text is not turned into a parameter: the tool has none to name
// (a long value goes in field as it is), so a text that says --field-file stays as the CLI says
// it. The other omitted options only appear in the tool descriptions, which read as parameters.
export const NO_PARAMETER: ReadonlySet<string> = new Set(['field-file']);

// A tool is named after its command, with words joined by underscores (send-back is send_back).
export function toolName(command: string): string {
  return command.replace(/[ -]/g, '_');
}
