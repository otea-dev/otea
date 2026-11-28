import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assistantStatus } from '../app/assistant.ts';
import { listConversation, postPersonMessage } from '../app/conversation.ts';
import { hearAgent, listAgents, processAlive } from '../app/presence.ts';
import { openProject } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { selectListenerProcesses } from '../store/queries.ts';
import { COMMANDS } from './commands.ts';
import { missedLately } from './harness-miss.ts';
import { listProcesses } from './owner.ts';
import {
  cliAt,
  declareProfiles,
  presetCollection,
  removeOnceReleased,
  type TempRepo,
  tempGitRepo,
  until,
} from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

// A process listing that takes longer than the guard waits (3 s) reads as «unverified» and lets the
// command through: an impostor then passes on a slow runner (a Windows CI run answered exit 0 where
// 7 was expected). Every session these tests start waits for its listing up to the guard's own
// ceiling instead, so the refusal rests on the listing completing, not on the machine's speed. The
// guard only lets the wait be raised (cli/session-guard.ts readMsOf), never shortened: that clamp
// is checked in session-judge.test.ts and, end to end against a stub listing, in session-wait.test.ts.
const SLOW_LISTING_OK = { OTEA_SESSION_READ_MS: '60000' };

// U8 (field study 4): `otea say "..." --as claude-sec` from any other process posted in Hablar
// labelled ASISTENTE, as the real one. The assistant is bound to the harness session noted for it:
// while that session runs, an act under its name from another harness is refused; once it is gone a
// new session takes over. A worker's name likewise cannot act on an item its live session leased.
describe('an agent name is bound to the harness session noted for it', () => {
  let repo: TempRepo;
  let scratch: string;
  const children: ChildProcess[] = [];
  // Each test names its own agents: an agent's home is the project it first worked in.
  let round = 0;
  let sol = '';
  let quill = '';

  beforeEach(async () => {
    round += 1;
    sol = `sol${round}`;
    quill = `quill${round}`;
    repo = tempGitRepo();
    scratch = mkdtempSync(join(tmpdir(), 'otea-session-bound-'));
    const owner = cliAt(repo.dir);
    await owner('init', '--local');
    declareProfiles(repo.dir, sol, quill);
    presetCollection(repo.dir, 'tasks');
    await owner('profile', '--role', 'assistant', '--as', sol);
    await cliAt(repo.dir, { OTEA_AGENT: quill })(
      'create',
      '--collection',
      'tasks',
      '--title',
      'First',
      '--description',
      'D',
    );
  }, 60_000);

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
    await removeOnceReleased(repo.dir);
  });

  // A harness session: a process named as a known one that runs one otea command once told to
  // (`go`), writes what it printed to a file and lives on, as a session does.
  const harness = (name: string, ...argv: string[]) =>
    harnessRunning(join(scratch, `${name}-claude-code.js`), name, ...argv);

  // The same, running a script a harness Otea knows by name runs (its first find is the session at
  // once, as a real one's: `claude`), not a process it takes for a candidate until a second wait.
  const knownHarness = (name: string, ...argv: string[]) => {
    mkdirSync(join(scratch, name));
    return harnessRunning(join(scratch, name, 'claude-code.js'), name, ...argv);
  };

  const harnessRunning = (script: string, name: string, ...argv: string[]) => {
    const out = join(scratch, `${name}.json`);
    const goFile = join(scratch, `${name}.go`);
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process');",
        "const { existsSync, renameSync, writeFileSync } = require('node:fs');",
        'const [out, goFile, main, ...argv] = process.argv.slice(2);',
        // Written whole, then put in place: the test reads the file as soon as it exists.
        "const publish = (text) => { writeFileSync(out + '.part', text); renameSync(out + '.part', out); };",
        'const run = () => {',
        "  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });",
        "  let text = ''; let err = '';",
        "  child.stdout.on('data', (d) => { text += d; });",
        "  child.stderr.on('data', (d) => { err += d; });",
        "  child.on('close', (code) => publish(JSON.stringify({ code, out: text, err })));",
        '};',
        'const poll = setInterval(() => { if (existsSync(goFile)) { clearInterval(poll); run(); } }, 50);',
        'setTimeout(() => {}, 120_000);',
      ].join('\n'),
    );
    const child = spawn(process.execPath, [script, out, goFile, MAIN, ...argv], {
      cwd: repo.dir,
      env: { ...process.env, ...SLOW_LISTING_OK },
      stdio: 'ignore',
    });
    children.push(child);
    const pid = child.pid as number;
    return {
      pid,
      // Noted as the session of `agent`: what its claim or wait leaves.
      boundTo: (agent: string, started?: number) => {
        const project = openProject(repo.dir);
        try {
          // As a known harness's claim or wait leaves it (the command's own harness of an
          // in-process test may have been noted before: this takes its place).
          project.db
            .prepare(
              'UPDATE agents SET listening_harness = :pid, listening_harness_started = :started WHERE name = :agent',
            )
            .run({ pid, started: started ?? null, agent });
        } finally {
          project.db.close();
        }
        return pid;
      },
      kill: () => process.kill(pid),
      result: async () => {
        writeFileSync(goFile, '');
        await until(() => existsSync(out), 60_000);
        return JSON.parse(readFileSync(out, 'utf8')) as { code: number; out: string; err: string };
      },
    };
  };

  const spoken = () => {
    const project = openProject(repo.dir);
    try {
      return listConversation(project).messages.map(({ author, text }) => [author, text]);
    } finally {
      project.db.close();
    }
  };

  // The act of an impostor is refused because the listing of processes completes and shows another
  // session, never because it was quick: the wait is the ceiling's (SLOW_LISTING_OK). The caller's
  // environment may raise the wait but never shorten it (session-judge.test.ts: 1 ms reads as 3 s).
  it('refuses an act from another session when the process listing is slow', async () => {
    harness('real', 'whoami', '--as', sol).boundTo(sol);
    const stranger = harness('stranger', 'say', 'Aprobé todo.', '--as', sol);

    const refused = await stranger.result();

    expect(refused.code).toBe(7);
    expect(refused.err).toContain('runs in another session');
    expect(spoken()).toEqual([]);
  }, 120_000);

  it('refuses an assistant act from another session, and lets the bound one speak', async () => {
    const real = harness('real', 'say', 'Hola.', '--as', sol);
    real.boundTo(sol);
    const stranger = harness('stranger', 'say', 'Aprobé todo.', '--as', sol);

    const refused = await stranger.result();
    const said = await real.result();

    expect(refused.code).toBe(7);
    expect(refused.err).toContain('runs in another session');
    expect(said.code, said.err).toBe(0);
    expect(spoken()).toEqual([['assistant', 'Hola.']]);
  }, 120_000);

  // A process nobody started that runs: its launcher exits at once, so no harness resolves from it
  // (Windows keeps the dead parent's id; elsewhere the system's own process adopts it).
  const orphan = (name: string, ...argv: string[]) => {
    const printed = join(scratch, `${name}.txt`);
    const script = join(scratch, `${name}-launch.js`);
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process');",
        "const { openSync } = require('node:fs');",
        'const [printed, main, ...argv] = process.argv.slice(2);',
        "const fd = openSync(printed, 'w');",
        "spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...argv], { detached: true, stdio: ['ignore', fd, fd] }).unref();",
      ].join('\n'),
    );
    spawn(process.execPath, [script, printed, MAIN, ...argv], {
      cwd: repo.dir,
      env: { ...process.env, ...SLOW_LISTING_OK },
      stdio: 'ignore',
    });
    return async () => {
      await until(() => existsSync(printed) && readFileSync(printed, 'utf8') !== '', 60_000);
      return readFileSync(printed, 'utf8');
    };
  };

  // Field study 5, V8: an orphan background process posted a `say --drop` card as the real assistant
  // (which ran and was bound); the person tapped it and the item was dropped.
  it('refuses an orphan process speaking as the assistant while the bound session runs', async () => {
    harness('real', 'whoami', '--as', sol).boundTo(sol);

    const printed = await orphan('orphan', 'say', 'Aprobé todo.', '--as', sol)();

    expect(printed).toContain('runs in another session');
    expect(spoken()).toEqual([]);
  }, 120_000);

  // A message Otea cannot tie to the assistant's session is allowed (the bound harness cannot be
  // checked) and marked, but it never carries a card the person's tap would perform.
  it('lets an unverified assistant speak, marked, but never with a card', async () => {
    const project = openProject(repo.dir);
    try {
      project.db
        .prepare(
          'UPDATE agents SET listening_harness = NULL, listening_harness_started = NULL WHERE name = :agent',
        )
        .run({ agent: sol });
    } finally {
      project.db.close();
    }

    const plain = await harness('plain', 'say', 'Hola.', '--as', sol).result();
    const card = await harness(
      'card',
      'say',
      '¿Lo saco?',
      '--drop',
      'TASKS-1',
      '--note',
      'ya no hace falta',
      '--option',
      'Sí',
      '--option',
      'No',
      '--as',
      sol,
    ).result();

    expect(plain.code, plain.err).toBe(0);
    expect(card.code).toBe(7);
    expect(card.err).toContain('could not be tied');
    expect(spoken()).toEqual([['assistant', 'Hola.']]);
  }, 120_000);

  // Field study 4, T1c: `otea pending --as <assistant>` from any session refreshed its last_seen, so a
  // dead assistant kept reading connected and nobody could take its role while something polled.
  it('answers a read from another session without keeping the assistant alive', async () => {
    const lastSeen = () => {
      const project = openProject(repo.dir);
      try {
        const row = project.db
          .prepare('SELECT last_seen AS at FROM agents WHERE name = :name')
          .get({ name: sol }) as { at: string } | undefined;
        return row?.at;
      } finally {
        project.db.close();
      }
    };
    // Its last sign is long past: a read that counted would show.
    const longAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    const age = () => {
      const project = openProject(repo.dir);
      try {
        project.db
          .prepare('UPDATE agents SET last_seen = :longAgo WHERE name = :name')
          .run({ longAgo, name: sol });
      } finally {
        project.db.close();
      }
    };
    harness('real', 'whoami', '--as', sol).boundTo(sol);
    age();

    const read = await harness('stranger', 'pending', '--as', sol).result();

    expect(read.code, read.err).toBe(0);
    expect(read.out).toContain('Nothing');
    expect(lastSeen()).toBe(longAgo);
  }, 120_000);

  it('lets the bound session read as the assistant and be seen', async () => {
    const real = harness('real', 'pending', '--as', sol);
    real.boundTo(sol);
    const longAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    const project = openProject(repo.dir);
    try {
      project.db
        .prepare('UPDATE agents SET last_seen = :longAgo WHERE name = :name')
        .run({ longAgo, name: sol });
    } finally {
      project.db.close();
    }

    const read = await real.result();

    expect(read.code, read.err).toBe(0);
    const after = openProject(repo.dir);
    try {
      const row = after.db
        .prepare('SELECT last_seen AS at FROM agents WHERE name = :name')
        .get({ name: sol }) as { at: string };
      expect(row.at > longAgo).toBe(true);
    } finally {
      after.db.close();
    }
  }, 120_000);

  it('lets a new session take over once the bound one is gone', async () => {
    const old = harness('old', 'whoami', '--as', sol);
    old.boundTo(sol);
    old.kill();
    await until(() => !processAlive(old.pid), 15_000);

    const next = await harness('next', 'say', 'Estoy de vuelta.', '--as', sol).result();

    expect(next.code, next.err).toBe(0);
    expect(spoken()).toEqual([['assistant', 'Estoy de vuelta.']]);
  }, 120_000);

  it('refuses the assistant’s relay and wait from another session too', async () => {
    harness('bound', 'whoami', '--as', sol).boundTo(sol);
    const person = openProject(repo.dir);
    try {
      postPersonMessage(person, { text: 'tiralo', files: [] });
    } finally {
      person.db.close();
    }

    const relay = await harness(
      'r',
      'relay',
      'TASKS-1',
      'discarded',
      '--quote',
      'tiralo',
      '--from-message',
      '1',
      '--reason',
      'x',
      '--as',
      sol,
    ).result();
    const wait = await harness('w', 'wait', '--assistant', '--timeout', '1', '--as', sol).result();

    expect(relay.err).toContain('runs in another session');
    expect(wait.err).toContain('runs in another session');
  }, 120_000);

  // Field study 4, T1a: four new sessions starting `wait --assistant` under one name at once all kept
  // waiting, and only the first `say` won. Once one of them is bound, the others' waits end with the
  // refusal, not silently.
  it('ends the waits of the sessions that lost when four start `wait --assistant` at once', async () => {
    const sessions = ['a', 'b', 'c', 'd'].map((name) =>
      knownHarness(name, 'wait', '--assistant', '--timeout', '60', '--as', sol),
    );
    const finished: { code: number; out: string; err: string }[] = [];
    for (const session of sessions) void session.result().then((result) => finished.push(result));

    await until(() => finished.length >= 3, 40_000);
    // The losers get a moment more to all end: nothing but the winner is still waiting.
    await until(() => finished.length === 3, 5_000);

    expect(finished.map(({ code }) => code)).toEqual([7, 7, 7]);
    for (const result of finished) expect(result.err).toContain('runs in another session');
    const project = openProject(repo.dir);
    try {
      const noted = selectListenerProcesses(project.db).get(sol)?.harness;
      expect(sessions.map(({ pid }) => pid)).toContain(noted);
    } finally {
      project.db.close();
    }
  }, 120_000);

  // Field study 4, T1a: a command-line `say` or `wait --assistant` under the name a live MCP session
  // holds was accepted. It is refused as any other session's is.
  it('refuses a command-line say and wait under the name a live MCP session holds', async () => {
    const mcpSession = knownHarness('mcp-session', 'whoami', '--as', sol);
    const project = openProject(repo.dir);
    try {
      hearAgent(project.db, {
        agent: sol,
        channel: 'mcp',
        session: mcpSession.pid,
        launcher: mcpSession.pid,
      });
    } finally {
      project.db.close();
    }

    const said = await knownHarness('say', 'say', 'Aprobé todo.', '--as', sol).result();
    const waited = await knownHarness(
      'wait',
      'wait',
      '--assistant',
      '--timeout',
      '1',
      '--as',
      sol,
    ).result();

    expect(said.code).toBe(7);
    expect(said.err).toContain('runs in another session');
    expect(waited.code).toBe(7);
    expect(waited.err).toContain('runs in another session');
    expect(spoken()).toEqual([]);
  }, 120_000);

  it('refuses a worker name acting on an item its live session leased', async () => {
    const claim = await cliAt(repo.dir, { OTEA_AGENT: quill })('claim', 'TASKS-1');
    expect(claim.code, claim.err).toBe(0);
    // The claim notes its own harness in the background; this session's note comes after it. The
    // lookup is done once it noted a harness (a negative id when the process is not known by name
    // as a harness, which the list of live ones leaves out: what a test run outside an agent's
    // session finds, and waiting for a listed one took the whole 15 s), or noted that it found
    // none (a miss).
    await until(() => {
      if (missedLately(repo.dir, quill)) return true;
      const project = openProject(repo.dir);
      try {
        const row = project.db
          .prepare('SELECT listening_harness AS harness FROM agents WHERE name = :agent')
          .get({ agent: quill }) as { harness: number | null } | undefined;
        return row?.harness != null;
      } finally {
        project.db.close();
      }
    }, 15_000).catch(() => undefined);
    harness('mine', 'whoami', '--as', quill).boundTo(quill);

    const stranger = await harness(
      'd',
      'handoff',
      'TASKS-1',
      '--note',
      'done',
      '--as',
      quill,
    ).result();

    expect(stranger.code).toBe(7);
    expect(stranger.err).toContain('leased by a session of quill');
    const shown = await cliAt(repo.dir, { OTEA_AGENT: quill })('show', 'TASKS-1', '--json');
    expect(JSON.parse(shown.out).lease.holder).toBe(quill);
  }, 120_000);

  // Adversarial review of S: the guard skipped every call over MCP, which acts under any name given
  // with `as`.
  describe('over MCP', () => {
    // A server started with no name (`otea mcp`): each call names its agent with `as`.
    const mcp = async (agent: string | undefined, use: (client: Client) => Promise<void>) => {
      const server = createMcpServer(COMMANDS, {
        cwd: repo.dir,
        ...(agent === undefined ? {} : { agent }),
        warn: () => {},
      });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        await use(client);
      } finally {
        await client.close();
      }
    };
    const call = async (client: Client, name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { text: string }[];
      };

    it('refuses an assistant act under its name from another session, and posts nothing', async () => {
      harness('real', 'whoami', '--as', sol).boundTo(sol);

      await mcp(undefined, async (client) => {
        const said = await call(client, 'say', { text: 'Aprobé todo.', as: sol });

        expect(said.isError).toBe(true);
        expect(said.content[0]?.text).toContain('runs in another session');
      });
      expect(spoken()).toEqual([]);
    }, 120_000);

    // Field study 5, V8: one impostor message left every later message of the real assistant
    // «sin verificar» (the server took the binding), and its end read the real one as disconnected.
    it('keeps the binding, the harness note and the listening of the real assistant when a server speaks as it', async () => {
      const real = harness('real', 'say', 'Hola de nuevo.', '--as', sol);
      real.boundTo(sol);
      const state = () => {
        const project = openProject(repo.dir);
        try {
          return {
            harness: selectListenerProcesses(project.db).get(sol)?.harness ?? null,
            listening: listAgents(project.db).find(({ name }) => name === sol)?.listening,
            messages: listConversation(project).messages.map(({ unverified }) => unverified),
          };
        } finally {
          project.db.close();
        }
      };
      const project = openProject(repo.dir);
      try {
        hearAgent(project.db, { agent: sol, channel: 'cli', waiter: real.pid });
      } finally {
        project.db.close();
      }
      expect(state()).toMatchObject({ harness: real.pid, listening: true });

      const client = new Client({ name: 'claude-code', version: '2.1.0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ['--disable-warning=ExperimentalWarning', MAIN, 'mcp', '--as', sol],
          cwd: repo.dir,
          // A slow runner's process listing may pass the 3 s the guard waits, which reads as
          // unverified and lets the call through: this test waits for the listing instead.
          // The whole environment, as the other process tests give theirs: the listing runs
          // powershell and ps, which need more than the transport's default set.
          env: {
            ...getDefaultEnvironment(),
            ...(Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ) as Record<string, string>),
            OTEA_SESSION_READ_MS: '20000',
          },
          stderr: 'pipe',
        }),
      );
      try {
        const said = await call(client, 'say', { text: 'Aprobé todo.' });
        expect(said.isError, said.content[0]?.text).toBe(true);
        expect(said.content[0]?.text).toContain('runs in another session');
        expect(state()).toMatchObject({ harness: real.pid, listening: true });
      } finally {
        await client.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(state()).toMatchObject({ harness: real.pid, listening: true });

      const said = await real.result();
      expect(said.code, said.err).toBe(0);
      // Nothing of the impostor's was posted, and the real one's message is verified.
      expect(state().messages).toEqual([false]);
    }, 120_000);

    it('verifies the assistant’s own MCP session: its message carries no unverified mark', async () => {
      const project = openProject(repo.dir);
      try {
        // The MCP server of this process heard the name, as `otea mcp` does at the first call.
        hearAgent(project.db, {
          agent: sol,
          channel: 'mcp',
          session: process.pid,
          launcher: process.ppid,
        });
      } finally {
        project.db.close();
      }

      await mcp(sol, async (client) => {
        const said = await call(client, 'say', { text: 'Hola.' });
        expect(said.isError, said.content[0]?.text).toBeFalsy();
      });

      const read = openProject(repo.dir);
      try {
        expect(listConversation(read).messages.map(({ unverified }) => unverified)).toEqual([
          false,
        ]);
      } finally {
        read.db.close();
      }
    }, 120_000);
  });

  describe('the process id is not the process', () => {
    const startOf = async (pid: number) => {
      const table = await listProcesses(AbortSignal.timeout(20_000));
      return table?.rows.find((row) => row.pid === pid)?.started;
    };

    it('takes a harness noted with another start time for a process id handed out again', async () => {
      const real = harness('old', 'whoami', '--as', sol);
      await until(() => true);
      const started = await startOf(real.pid);
      // The system may not say it (then the guard cannot tell either, and the test says nothing).
      if (started === undefined) return;
      real.boundTo(sol, started - 3_600_000);

      const next = await harness('next', 'say', 'Estoy de vuelta.', '--as', sol).result();

      expect(next.code, next.err).toBe(0);
    }, 120_000);

    it('keeps the binding when the start time is the one noted', async () => {
      const real = harness('real', 'whoami', '--as', sol);
      const started = await startOf(real.pid);
      if (started === undefined) return;
      real.boundTo(sol, started);

      const stranger = await harness('stranger', 'say', 'Aprobé todo.', '--as', sol).result();

      expect(stranger.code).toBe(7);
    }, 120_000);
  });
});

// Adversarial review of S: an impersonator's first `wait` took the role before the real assistant
// had waited once. The declaration notes the harness, and a later wait from another live harness
// neither takes the role nor overwrites it.
describe('the assistant’s declaration notes its harness', () => {
  let repo: TempRepo;
  let scratch: string;
  const children: ChildProcess[] = [];

  beforeEach(() => {
    repo = tempGitRepo();
    scratch = mkdtempSync(join(tmpdir(), 'otea-session-declare-'));
  });

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid !== undefined && processAlive(child.pid)) process.kill(child.pid);
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
    await removeOnceReleased(repo.dir);
  });

  const harnessRunning = (name: string, ...argv: string[]) => {
    const out = join(scratch, `${name}.json`);
    // A script named as a known harness: Otea trusts it at its first find.
    mkdirSync(join(scratch, name));
    const script = join(scratch, name, 'claude-code.js');
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process');",
        "const { renameSync, writeFileSync } = require('node:fs');",
        'const [out, main, ...argv] = process.argv.slice(2);',
        // Written whole, then put in place: the test reads the file as soon as it exists.
        "const publish = (text) => { writeFileSync(out + '.part', text); renameSync(out + '.part', out); };",
        "const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] });",
        "let text = ''; let err = '';",
        "child.stdout.on('data', (d) => { text += d; });",
        "child.stderr.on('data', (d) => { err += d; });",
        "child.on('close', (code) => publish(JSON.stringify({ code, out: text, err })));",
        'setTimeout(() => {}, 120_000);',
      ].join('\n'),
    );
    const child = spawn(process.execPath, [script, out, MAIN, ...argv], {
      cwd: repo.dir,
      env: { ...process.env, ...SLOW_LISTING_OK },
      stdio: 'ignore',
    });
    children.push(child);
    return {
      pid: child.pid as number,
      result: async () => {
        await until(() => existsSync(out), 60_000);
        return JSON.parse(readFileSync(out, 'utf8')) as { code: number; out: string; err: string };
      },
    };
  };

  const notedFor = (agent: string) => {
    const project = openProject(repo.dir);
    try {
      return selectListenerProcesses(project.db).get(agent)?.harness ?? null;
    } finally {
      project.db.close();
    }
  };

  it('binds the assistant to the session that declared it, and a later wait of another is refused', async () => {
    const owner = cliAt(repo.dir);
    await owner('init', '--local');
    const real = harnessRunning(
      'real',
      'profile',
      '--role',
      'assistant',
      '--model',
      'm',
      '--effort',
      'high',
      '--harness',
      'claude-code',
      '--as',
      'solo',
    );
    const declared = await real.result();
    expect(declared.code, declared.err).toBe(0);
    expect(notedFor('solo')).toBe(real.pid);

    const intruder = harnessRunning(
      'intruder',
      'wait',
      '--assistant',
      '--timeout',
      '1',
      '--as',
      'solo',
    );
    const refused = await intruder.result();

    expect(refused.code).toBe(7);
    expect(refused.err).toContain('runs in another session');
    expect(notedFor('solo')).toBe(real.pid);
  }, 120_000);

  // S2, P2 (final red-team run): four sessions declaring `profile --role assistant` under one new
  // name at once all answered success, and it was unclear which was the assistant. One declaration
  // wins, as one session wins a wait (noteHarness): the others are refused, nothing of theirs kept,
  // and the project says which session is the assistant.
  it('lets one of four sessions that declare the assistant at once win, and says which', async () => {
    const owner = cliAt(repo.dir);
    await owner('init', '--local');
    const sessions = ['a', 'b', 'c', 'd'].map((name) =>
      harnessRunning(
        name,
        'profile',
        '--role',
        'assistant',
        '--model',
        'm',
        '--effort',
        'high',
        '--harness',
        'claude-code',
        '--as',
        'solo',
      ),
    );

    const results = await Promise.all(sessions.map((session) => session.result()));

    const winners = sessions.filter((_, index) => results[index]?.code === 0);
    expect(winners).toHaveLength(1);
    const losers = results.filter(({ code }) => code !== 0);
    expect(losers.map(({ code }) => code)).toEqual([7, 7, 7]);
    for (const loser of losers) expect(loser.err).toContain('declared by another session');
    const winner = winners[0]?.pid;
    expect(notedFor('solo')).toBe(winner);
    const status = await cliAt(repo.dir)('whoami', '--as', 'solo');
    expect(status.out).toContain(`session ${winner}`);
    const project = openProject(repo.dir);
    try {
      expect(assistantStatus(project.db)?.session).toBe(winner);
    } finally {
      project.db.close();
    }
  }, 120_000);
});
