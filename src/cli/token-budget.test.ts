import { writeFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENTS_BLOCK } from '../app/agents.ts';
import { leaveNote } from '../app/notes.ts';
import { openProject } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, declareProfiles, presetCollection, tempGitRepo } from './testing.ts';

// What an agent reads back costs tokens on every call, so each operation has a budget per surface:
// the CLI text, the CLI --json and the MCP tool result. Tokens are estimated as characters / 4,
// rounded up: no tokenizer, close enough to catch a regression. Each budget is the size measured on
// the bug below when the budget was set, plus about 10% headroom. Raise one only on purpose, and
// say why in the commit. OTEA_TOKEN_REPORT=<file> writes the measured sizes there.
// A tool answers with the CLI's text in the words of the tools, so each MCP budget is lowered to
// about the text's: the whole item as JSON had made a work cycle cost 54% more over MCP than over
// the CLI (MCP-TOKENS). Measured at show 607, list 25, board index 20, board 157, create 18,
// claim 25, handoff 70, attach 12 and wait 80; otea mcp --json keeps the data, under --json's.
const tokens = (text: string) => Math.ceil(text.length / 4);

type Surface = 'text' | 'json' | 'mcp';
type Sizes = Partial<Record<Surface, number>>;

const BUDGETS: Readonly<Record<string, Sizes>> = {
  // The bug being fixed: every field, six events, two evidence files.
  // Raised when show's Next: became next's whole answer on a board, and again when a preset's
  // playbook became the board's text: Next: gives its first paragraph and where the rest is.
  // Raised when --json and MCP gave each field as { id, name, value } and each step its name.
  // Raised when each file got a path an agent can open: one per file in --json and MCP, one line
  // with the first as the example in the text (P5-R2-4; measured at 584, 1174 and 1179).
  // Over MCP the item's fields come as one JSON line (measured at 603 in the text, 1197 in --json
  // and 507 in MCP).
  show: { text: 640, json: 1290, mcp: 560 },
  // The same item read with --brief, for the repeat read of an item the agent holds and already
  // read: without the board's words, the step's "Before you hand it off" and the checklist lines
  // met (measured at 417 in the text, 1013 in --json and 428 in MCP).
  'show brief': { text: 460, json: 1120, mcp: 470 },
  // next on that item, whole as on claiming it, and with --brief (measured at 346, 405 and 366;
  // 234, 295 and 251).
  next: { text: 380, json: 450, mcp: 400 },
  'next brief': { text: 260, json: 325, mcp: 280 },
  // One row per item; measured with that bug alone. Raised with show, for the same names.
  list: { text: 25, json: 285, mcp: 30 },
  // Raised when otea board began with Otea's agent guide (instructions below): read once a session.
  // Raised again with the guide's line on declaring the profile (otea profile), and with its line
  // on asking the person with otea ask (measured at 308), and its line on proposing a new board
  // with otea board draft --new (measured at 341), and its line on keeping going after a handoff,
  // waiting when there is nothing (measured at 412), and with board draft's --template and asking
  // the person first (measured at 432), and with next following the order the person set on the
  // Matrix, a word agents did not know (measured at 449), and with claiming again once a lease ran
  // out and a subagent releasing what it holds before it ends (measured at 473), and with every
  // chat request going on a board first and waiting in a background shell (measured at 512).
  // Raised to 560 for otea whoami, which gives a new session the name it worked under. Raised to
  // 630 with the guide's lines on answering in Otea and on staying in the wait (measured at 606).
  // Raised to 640 with the guide's line on otea answer (P4-R2-2; measured at 633). Raised to 660
  // with rule 2 saying to declare what the session says and never to open config files outside the
  // project, as an agent read the person's harness settings to learn its effort (P3C-R3-8; measured
  // at 649). Raised to 700 with rule 12 saying to set an item aside with otea release --later when
  // the person wants it later, and never to poll in a loop of one's own, as an agent did both
  // (P3C-R3-2; measured at 690). Raised to 730 with rule 3 saying that otea calls keep a claim and
  // to send otea heartbeat on a long step with none, as a subagent's lease ran out mid-rebase and
  // another agent took the item over (P1-R3-6; measured at 720). Raised to 755 with rule 4 saying
  // a new board or a change to one goes through board draft, never otea create, as an agent made
  // a Pedido with otea create and board draft --change made a second one (P8-R3-3; measured at 746).
  // Over MCP too, from when AGENTS.md stopped copying the guide: there it sends an agent whose
  // client shows no instructions (measured at 756).
  // Raised to 830 with rule 3 listing the real order next offers in (what you hold, what the
  // person left you, sent-back, merges first, on top, approved, new) and --brief for repeat reads
  // (measured at 815 and 825).
  // Raised to 870 with rule 11 naming the four outcomes of the interview (a template as it is,
  // with changes, a board of its own, or Otea is no fit), so an agent never drafts a board for
  // work that does not need one (measured at 857).
  // Raised again for rule 10: ask with 2 to 4 options and the one you recommend, so the person
  // taps instead of reading and typing (raised to 895 and 890; measured at 894 and 885).
  // Raised for rule 13, the secretary (0.8): who alone talks with the person in Hablar, so no other
  // agent writes there (raised to 945 and 935; measured at 942 and 933).
  // Raised again for the secretary skipping rules 3, 6 and 12 and rule 4's second heading (raised
  // to 990 and 975; measured at 980 and 970).
  'board index': { text: 990, json: 53, mcp: 975 },
  // The bug board's own words and each step's instructions, read once per session; show's Next:
  // block covers the step at hand. Raised when a preset collection read as a board kept its
  // playbook as the board's text: what agents read on the preset, as before.
  // Lowered when the guide moved to the index alone: one board gives it no second time (measured
  // at 159 and 157).
  board: { text: 175, json: 3090, mcp: 175 },
  // On a board, create says where the item starts (and why its first step was skipped).
  // The item rows below were raised with show, for the same names.
  create: { text: 20, json: 270, mcp: 22 },
  claim: { text: 25, json: 285, mcp: 30 },
  // Raised for its last line, the exact commands to keep going and wait, as wait's: an agent said it
  // left a wait running and started none (P3C-R3-9; measured at 50, and 308 in --json and MCP).
  handoff: { text: 55, json: 340, mcp: 80 },
  attach: { text: 15, json: 90, mcp: 15 },
  // Raised for its last line, the exact command to keep going and wait again (measured at 60).
  // Over MCP it gives where the item that woke it stands as an object (id, state, turn) beside the
  // line (measured at 124).
  wait: { text: 70, json: 285, mcp: 140 },
  // The tool definitions an MCP client reads when it connects.
  // Raised for next, handoff, approve and send_back, the board moves.
  // drop, handoff's --note and its ways back. Raised for the as every tool takes: the agent making
  // the call, so subagents sharing one server keep their own leases. Raised for reply, the answer
  // to a note from the person, and wait saying a note wakes it (measured at 3347). Raised for ask,
  // an agent's question to the person, which hands the turn over (measured at 3481). Raised for
  // board_draft's new and why, an agent proposing a board the person asked for (measured at 3606).
  // Raised for merged, recording that a Done item's branch is in (measured at 3768). Raised for
  // tick, a checklist point with its proof, and attach's --point (measured at 3980). Raised for
  // topic_add and topic_answer, the side topics an agent records, and create's --from (measured
  // at 4275). Raised for reopen, the way back for a Done item whose PR conflicts (measured at 4393). Raised for
  // detach, taking back a file attached by mistake (measured at 4541). Raised for topic_list (with
  // its search) and topic_show, so an agent asked what was concluded before reads the topics kept
  // (measured at 4806). Raised for whoami, the name a new session worked under before. Raised for
  // release's --later, setting aside an item the person wants for later (measured at 5012). Raised
  // for topic_list's all-projects and topic_show's project: what was concluded about one project is
  // often asked in another (P6-R2-4; measured at 5078). Raised for board_draft's change, an agent
  // proposing a field or a step for a published board, which agents told the person they could not
  // do (P4-6; measured at 5134 with board_draft's summary trimmed). Raised for reply's note, whose
  // description was only "n": an agent answered a send-back reason with it three times, so it says
  // what the number is and that a send-back reason is not one (P2S-R3-5; measured at 5162).
  // Raised for answer, the person's answer to a question given in the chat, which an agent could
  // not put on the question and asked the person to paste into Otea (P4-R2-2; measured at 5272).
  // Raised for profile's help: declare what the session says, never a config file opened outside
  // the project, which an agent read to learn its effort (P3C-R3-8; measured at 5288). Raised for
  // release's quote: only the person's newer words, relayed, set aside again an item they took up
  // again, as an agent set one aside right after Retomar with their note unanswered (P7-R3-8;
  // measured at 5314).
  // Raised for --brief on next and show (measured at 5408).
  // Raised for the schemas an agent could not fill in (P8-F5; measured at 6072): `as` required where
  // a call needs a name, an example item id and the relation kinds, the timeout typed as seconds or
  // a duration, the board JSON as board_draft's own argument (P8-F2), model and effort on next, and
  // every tool's `additionalProperties`, so a key it does not take is refused by name, not dropped.
  // Raised to 6160 for ask's options and recommended (measured at 6143).
  // Raised to 6230 for the secretary: profile's role and wait's secretary (measured at 6215).
  // Raised to 6620 for the secretary's conversation: two tools (conversation, say) and create's
  // from_message (measured at 6577).
  // Raised to 6930 for the Bandeja's refiner: two tools (bandeja, bandeja_take), create's
  // from_bandeja and ask on an entry (measured at 6924).
  // Raised to 7000 for say's options and recommended, so the secretary's question has buttons
  // (measured at 6994).
  // Raised to 7150 for land sync, the one step that brings the person's main checkout up to date
  // (measured at 7144).
  // Raised to 7420 for what waits for the person: two tools (pending, escalate; measured at 7410).
  // Raised to 7600 for closing a Bandeja note and taking the next one (bandeja_close, and --next,
  // --wait and --timeout on bandeja_take; measured at 7593).
  tools: { mcp: 7600 },
  // Otea's agent guide, the server's instructions: in every MCP agent's context from the start, so
  // it buys only what agents keep getting wrong. Measured at 203. Raised to 270 for the line on
  // declaring the profile every agent and subagent must keep current (measured at 246). Raised to
  // 300 for the line on asking the person only with otea ask, the one way that hands the turn over
  // (measured at 279). Raised to 340 for the line on proposing a new board with board draft --new,
  // which agents told the person they could not do (measured at 312). Raised to 400 for the line on
  // keeping going until the person stops it, as agents did one item and ended (measured at 383).
  // Raised to 410 for drafting a board from a template after asking the person (measured at 403).
  // Raised to 450 for next following the order the person set on the Matrix, a view agents asked
  // to "use the Matrix" did not know (measured at 430). Raised to 470 for claiming again once a
  // lease ran out, which Otea now enforces, and for a subagent releasing what it holds before it
  // ends, as dead subagents' leases blocked the lead (measured at 454). Raised to 510 for every chat
  // request going on a board first, as an agent did eleven chat requests with no item, and for
  // waiting in a background shell, as the MCP wait tool held OpenCode's chat (measured at 494).
  // Raised to 545 for otea whoami (rule 1), so one agent keeps one name across sessions. Raised to
  // 610 for telling the person to answer in Otea, not in the chat (P4-R2-2), and for staying in the
  // wait: only it hears the desk, agents went back to it neither after a chat reply nor stopped it
  // safely (P2S-6, P8-R2-13, P8-R2-11; measured at 587). Raised to 620 because people answer in the
  // chat anyway: rule 10 now says that answer goes on the question with otea answer, where it
  // said to tell them to answer in Otea (P4-R2-2; measured at 614). Raised to 640 for rule 2:
  // declare what the session says, never open config files outside the project, as «read from your
  // settings» sent an agent to the person's harness settings (P3C-R3-8; measured at 630). Raised
  // to 680 for rule 12: «leave it for later» is otea release --later, and otea wait is the way to
  // wait, as an agent released an item plainly, stopped waiting and later polled on its own
  // (P3C-R3-2; measured at 671). Raised to 710 for rule 3: otea calls keep a claim, and a long step
  // with none (a rebase, a test run) sends otea heartbeat, as a subagent's lease ran out mid-rebase
  // and another agent took the item over while it still worked (P1-R3-6; measured at 702). Raised
  // to 735 for rule 4: a new board or a change to one goes through board draft, never otea create,
  // as an agent made a Pedido with otea create and board draft --change made a second (P8-R3-3;
  // measured at 727).
  // Raised to 810 for rule 3: the real order next offers in, and --brief for repeat reads, which
  // a new session or a compacted agent would otherwise be handed without the step (measured at
  // 796). Raised to 850 with rule 11's four outcomes (measured at 826).
  // Raised to 870 for rule 10: ask always with options and a recommendation (measured at 865).
  // Raised to 915 for rule 13: the secretary alone talks with the person in Hablar (measured at 913).
  // Raised to 960 for rule 13 telling the secretary to skip rules 3, 6 and 12 (it is printed to it
  // too, and told it to claim and wait for turns), rule 4's second heading and the real silent time
  // (measured at 952).
  instructions: { mcp: 960 },
  // The AGENTS.md block, in the context of every agent whose harness reads AGENTS.md: it says where
  // the guide is and holds no copy of it, which the instructions or otea board's index give
  // (MCP-TOKENS: the guide was in context two or three times; measured at 874 with the copy, 107).
  'AGENTS.md': { text: 120 },
};

// A bug as an agent files it in the bug-triage preset, every field filled.
const DESCRIPTION = 'Saving a draft with an emoji in the title crashes the editor.';
const FIELDS = [
  'steps=1. Open a new draft\n2. Type "Hi 👋" as the title\n3. Press Save',
  'expected=The draft is saved.',
  'actual=The editor shows a blank page and the console logs a RangeError.',
  'environment=Firefox 131, macOS 15',
  'severity=high',
  'category=crash',
  'area=editor',
];
const TITLE = 'Emoji title crashes the editor';
const BUG_ARGS = [
  '--collection',
  'bugs',
  '--title',
  TITLE,
  '--description',
  DESCRIPTION,
  ...FIELDS.flatMap((field) => ['--field', field]),
];

type Call = { cli: string[]; mcp: Record<string, unknown> };

describe('token budget', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  let client: Client;
  const sizes: Record<string, Sizes> = {};

  const ok = async (...argv: string[]) => {
    const result = await otea(...argv);
    if (result.code !== 0) throw new Error(`otea ${argv.join(' ')}: ${result.err}`);
    return result.out;
  };

  const toolText = async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
    const reply = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    const text = reply.content[0]?.text ?? '';
    if (reply.isError) throw new Error(`${name}: ${text}`);
    return text;
  };

  // Runs the operation as text, as --json and as an MCP tool. A write gets a fresh call (a fresh
  // item) for each surface, so all three read back the same thing.
  const measure = async (name: string, tool: string, next: () => Promise<Call>) => {
    const text = await ok(...(await next()).cli);
    const json = await ok(...(await next()).cli, '--json');
    const mcp = await toolText({ name: tool, args: (await next()).mcp });
    sizes[name] = { text: tokens(text), json: tokens(json), mcp: tokens(mcp) };
  };

  // A bug filed, accepted by the human in conversation and claimed: ready to be fixed.
  const accepted = async () => {
    const { id } = JSON.parse(await ok('create', ...BUG_ARGS, '--json')) as { id: string };
    await ok('relay', id, 'accepted', '--quote', 'Yes, fix it');
    await ok('claim', id);
    return id;
  };

  const same = (call: Call) => async () => call;
  const onAccepted = (call: (id: string) => Call) => async () => call(await accepted());

  beforeAll(async () => {
    repo = tempGitRepo();
    repo.write('shots/before.png', 'x'.repeat(2048));
    repo.write('test.log', 'PASS 12 tests\n');
    otea = cliAt(repo.dir, { OTEA_AGENT: 'claude' });
    await ok('init', '--template', 'none');
    declareProfiles(repo.dir, 'claude');
    presetCollection(repo.dir, 'bugs', 'bug-triage');
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'claude', warn: () => {} });
    client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);

    // next wants the profile confirmed in each session.
    await ok(
      'profile',
      '--model',
      'claude-opus-5-5',
      '--effort',
      'high',
      '--harness',
      'claude-code',
    );
    await client.callTool({
      name: 'profile',
      arguments: { as: 'claude', model: 'claude-opus-5-5', effort: 'high' },
    });

    // The bug being fixed, with proof attached.
    const id = await accepted();
    await ok('attach', id, 'shots/before.png', '--role', 'before', '--caption', 'Blank page');
    await ok('attach', id, 'test.log', '--caption', '12 tests pass');

    await measure('show', 'show', same({ cli: ['show', id], mcp: { id } }));
    // What an agent that read the item asks for again with --brief costs a part less.
    await measure(
      'show brief',
      'show',
      same({ cli: ['show', id, '--brief'], mcp: { id, brief: true } }),
    );
    await measure('next', 'next', same({ cli: ['next'], mcp: {} }));
    await measure('next brief', 'next', same({ cli: ['next', '--brief'], mcp: { brief: true } }));
    await measure('list', 'list', same({ cli: ['list'], mcp: {} }));
    await measure(
      'wait',
      'wait',
      same({ cli: ['wait', '--turn', 'agent'], mcp: { turn: 'agent' } }),
    );
    await measure('board index', 'board', same({ cli: ['board'], mcp: {} }));
    await measure('board', 'board', same({ cli: ['board', 'bugs'], mcp: { name: 'bugs' } }));
    await measure(
      'create',
      'create',
      same({
        cli: ['create', ...BUG_ARGS],
        mcp: { collection: 'bugs', title: TITLE, description: DESCRIPTION, field: FIELDS },
      }),
    );
    await measure('claim', 'claim', async () => {
      const { id } = JSON.parse(await ok('create', ...BUG_ARGS, '--json')) as { id: string };
      await ok('relay', id, 'accepted', '--quote', 'Yes, fix it');
      return { cli: ['claim', id], mcp: { id } };
    });
    await measure(
      'handoff',
      'handoff',
      onAccepted((id) => ({
        cli: ['handoff', id, '--note', 'Saved with an emoji: no crash'],
        mcp: { id, note: 'Saved with an emoji: no crash' },
      })),
    );
    await measure(
      'attach',
      'attach',
      onAccepted((id) => ({
        cli: ['attach', id, 'test.log', '--caption', '12 tests pass'],
        mcp: { id, file: 'test.log', caption: '12 tests pass' },
      })),
    );
    sizes.tools = { mcp: tokens(JSON.stringify(await client.listTools())) };
    sizes.instructions = { mcp: tokens(client.getInstructions() ?? '') };
    sizes['AGENTS.md'] = { text: tokens(AGENTS_BLOCK) };
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    repo?.remove();
    const report = process.env.OTEA_TOKEN_REPORT;
    if (report) writeFileSync(report, `${JSON.stringify(sizes, null, 2)}\n`);
  });

  for (const [name, budget] of Object.entries(BUDGETS)) {
    it(`keeps ${name} within its budget`, () => {
      for (const [surface, limit] of Object.entries(budget)) {
        expect(sizes[name]?.[surface as Surface], `${name} ${surface}`).toBeLessThanOrEqual(limit);
      }
    });
  }

  // The point of --brief: a repeat read costs a clear part less than the whole in the text, and
  // less on every surface (--json and the MCP text carry the fields either way).
  it('reads brief at most 75% of the whole in the text, and less elsewhere', () => {
    for (const name of ['show', 'next']) {
      const whole = sizes[name];
      const brief = sizes[`${name} brief`];
      expect(brief?.text ?? Number.POSITIVE_INFINITY, `${name} text`).toBeLessThanOrEqual(
        (whole?.text ?? 0) * 0.75,
      );
      for (const surface of ['json', 'mcp'] as const) {
        expect(brief?.[surface] ?? Number.POSITIVE_INFINITY, `${name} ${surface}`).toBeLessThan(
          whole?.[surface] ?? 0,
        );
      }
    }
  });
});

// One work cycle as MCP-TOKENS measured it, on the Pendientes board: next --claim, show, update a
// field, ask, reply to the person's note and hand off, then next. Each step counts the call as the
// harness writes it (a Bash command for the CLI, a tool call for MCP) and what comes back; the
// person's answer and note are off the meter. Measured at 2,122 over the CLI and 3,267 over MCP,
// which returned the whole item as JSON; with the CLI's text, at 2,122 and 2,244.
const CYCLE_BUDGET = { cli: 2340, mcp: 2470 };

describe('token budget of a work cycle', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  let client: Client;
  const spent = { cli: 0, mcp: 0 };

  const ok = async (...argv: string[]) => {
    const result = await otea(...argv);
    if (result.code !== 0) throw new Error(`otea ${argv.join(' ')}: ${result.err}`);
    return result.out;
  };
  const quote = (arg: string) => (/[\s"'=]/.test(arg) ? `"${arg.replace(/[\\"]/g, '\\$&')}"` : arg);

  // The item the person filed, as each surface's agent will find it.
  const file = (title: string) =>
    ok(
      'create',
      '--as',
      'setup',
      '--collection',
      'Pendientes',
      '--title',
      title,
      '--field',
      'Qué hace falta=Write a short welcome text for the README',
      '--field',
      'Listo cuando=The README starts with a welcome paragraph',
      '--field',
      'Lo hago yo=no',
      '--field',
      'Impacto=media',
      '--field',
      'Esfuerzo=Pequeño',
    );

  // The person answers the question and leaves a note, off the meter; the note's number.
  const person = async (id: string) => {
    await ok('answer', id, 'No, keep it short', '--as', 'relay');
    const project = openProject(repo.dir);
    try {
      return leaveNote(project, {
        id,
        text: 'Use a friendly tone',
        actor: { kind: 'human', name: 'human' },
        channel: 'ui',
      }).note;
    } finally {
      project.db.close();
    }
  };

  const stepsOn = (id: string) => ({
    show: { id },
    update: { id, field: ['Lo que hice=Wrote the welcome paragraph at the top of README.md'] },
    ask: { id, question: 'Should the welcome mention the license?' },
  });

  beforeAll(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir);
    await ok('init', '--template', 'todos');
    declareProfiles(repo.dir, 'cli-a', 'mcp-a');
    for (const title of ['cli item 1', 'cli item 2']) await file(title);

    const cli = async (...args: string[]) => {
      const command = ['otea', ...args, '--as', 'cli-a'].map(quote).join(' ');
      const out = await ok(...args, '--as', 'cli-a');
      spent.cli += tokens(JSON.stringify({ name: 'Bash', input: { command } })) + tokens(out);
      return out;
    };
    const id = (await cli('next', '--claim')).match(/\b[A-Z]+-\d+\b/)?.[0] ?? '';
    const steps = stepsOn(id);
    await cli('show', id);
    await cli('update', id, '--field', steps.update.field[0] ?? '');
    await cli('ask', id, steps.ask.question);
    const note = await person(id);
    await cli('reply', id, 'Done, the tone is friendly now', '--note', String(note));
    await cli('handoff', id, '--note', 'Welcome paragraph added');
    await cli('next');

    for (const title of ['mcp item 1', 'mcp item 2']) await file(title);
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, warn: () => {} });
    client = new Client({ name: 'claude-code', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const mcp = async (name: string, args: Record<string, unknown>) => {
      const input = { as: 'mcp-a', ...args };
      const reply = (await client.callTool({ name, arguments: input })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      const text = reply.content.map((part) => part.text).join('\n');
      if (reply.isError) throw new Error(`${name}: ${text}`);
      spent.mcp += tokens(JSON.stringify({ name: `mcp__otea__${name}`, input })) + tokens(text);
      return text;
    };
    // A session declares its profile once, before the cycle (MCP-TOKENS counts it as fixed).
    await client.callTool({
      name: 'profile',
      arguments: { as: 'mcp-a', model: 'claude-opus-5-5', effort: 'high' },
    });
    const taken = (await mcp('next', { claim: true })).match(/\b[A-Z]+-\d+\b/)?.[0] ?? '';
    const on = stepsOn(taken);
    await mcp('show', on.show);
    await mcp('update', on.update);
    await mcp('ask', on.ask);
    const asked = await person(taken);
    await mcp('reply', { id: taken, answer: 'Done, the tone is friendly now', note: asked });
    await mcp('handoff', { id: taken, note: 'Welcome paragraph added' });
    await mcp('next', {});
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    repo?.remove();
    const report = process.env.OTEA_TOKEN_REPORT;
    if (report) writeFileSync(`${report}.cycle.json`, `${JSON.stringify(spent, null, 2)}\n`);
  });

  it('keeps a cycle within its budget on each surface', () => {
    expect(spent.cli, 'cli').toBeLessThanOrEqual(CYCLE_BUDGET.cli);
    expect(spent.mcp, 'mcp').toBeLessThanOrEqual(CYCLE_BUDGET.mcp);
  });
});
