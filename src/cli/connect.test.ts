import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAgents } from '../app/presence.ts';
import { openProject } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS, INIT_NEXT } from './commands.ts';
import { type Cli, cliAt, tempGitRepo } from './testing.ts';

// The profile connect gives the agent it pins.
const PROFILE = ['--model', 'claude-opus-5-5', '--effort', 'high'];

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

const BLOCK = [
  '<!-- otea:begin -->',
  '## Otea',
  '',
  "This project hands work between people and agents through Otea. Follow Otea's agent guide to the letter. Over MCP it is the Otea server's instructions. On the command line, or when your client shows no instructions, read it first with `otea board` (MCP: the `board` tool with no name), which also lists the boards. Then `otea next` gives the item to take and what its step asks.",
  '<!-- otea:end -->',
].join('\n');

describe('setup for agents', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;

  const read = (path: string) => readFileSync(join(repo.dir, path), 'utf8');
  const json = async (...argv: string[]) => JSON.parse((await otea(...argv, '--json')).out);

  beforeEach(() => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir);
  });

  afterEach(() => repo.remove());

  describe('init --agents-md', () => {
    it('never touches AGENTS.md without the flag', async () => {
      await otea('init', '--local');

      expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
    });

    it('creates AGENTS.md with the Otea block', async () => {
      const { code, out } = await otea('init', '--local', '--agents-md');

      expect(code).toBe(0);
      expect(read('AGENTS.md')).toBe(`${BLOCK}\n`);
      expect(out).toBe(
        `Project data in ${join(repo.dir, '.otea')}\nAdded the Otea block to ${join(repo.dir, 'AGENTS.md')}\n${INIT_NEXT.join('\n')}\n`,
      );
    });

    it('appends the block to an existing AGENTS.md and keeps what it says', async () => {
      repo.write('AGENTS.md', '# Agents\n\nRun the tests.\n');

      expect((await json('init', '--local', '--agents-md')).agentsMd).toEqual({
        path: join(repo.dir, 'AGENTS.md'),
        action: 'added',
      });
      expect(read('AGENTS.md')).toBe(`# Agents\n\nRun the tests.\n\n${BLOCK}\n`);
    });

    it('is idempotent: running it again changes nothing', async () => {
      repo.write('AGENTS.md', '# Agents\n');
      await otea('init', '--local', '--agents-md');
      const once = read('AGENTS.md');

      expect((await json('init', '--local', '--agents-md')).agentsMd.action).toBe('unchanged');
      expect(read('AGENTS.md')).toBe(once);
    });

    it('replaces an outdated block in place instead of adding a second one', async () => {
      repo.write(
        'AGENTS.md',
        '# Agents\n\n<!-- otea:begin -->\nold words\n<!-- otea:end -->\n\n## Style\n',
      );

      expect((await json('init', '--local', '--agents-md')).agentsMd.action).toBe('updated');
      expect(read('AGENTS.md')).toBe(`# Agents\n\n${BLOCK}\n\n## Style\n`);
    });

    // Windows with core.autocrlf=true checks AGENTS.md out with CRLF, block included: Otea's own
    // block there is up to date, and a block it adds goes in with the file's line endings.
    it('keeps the line endings of a CRLF file: the same block there is unchanged, a new one is CRLF', async () => {
      const crlf = (text: string) => text.replaceAll('\n', '\r\n');
      repo.write('AGENTS.md', crlf('# Agents\n\nRun the tests.\n'));

      expect((await json('init', '--local', '--agents-md')).agentsMd.action).toBe('added');
      expect(read('AGENTS.md')).toBe(crlf(`# Agents\n\nRun the tests.\n\n${BLOCK}\n`));

      expect((await json('init', '--local', '--agents-md')).agentsMd.action).toBe('unchanged');
      expect(read('AGENTS.md')).toBe(crlf(`# Agents\n\nRun the tests.\n\n${BLOCK}\n`));
    });
  });

  describe('connect', () => {
    let id: string;

    beforeEach(async () => {
      await otea('init', '--local');
      id = (await json('projects', 'current')).id;
    });

    // The server an agent adds to its own harness: pinned to the project, naming no agent.
    const entry = () => ({
      command: 'node',
      args: ['--disable-warning=ExperimentalWarning', MAIN, 'mcp', '--project', id],
    });

    // Whether the desk shows the agent asked for MCP and was never heard through it.
    const missing = (name: string) => {
      const project = openProject(repo.dir);
      try {
        return listAgents(project.db).find((agent) => agent.name === name)?.mcpMissing;
      } finally {
        project.db.close();
      }
    };

    it('refuses a pinned agent writing to another project, and lets it write to its own', async () => {
      const elsewhere = cliAt(repo.dir, {
        OTEA_AGENT: 'claude-b',
        OTEA_PROJECT_ID: 'other-zzzzzz',
      });
      const refused = await elsewhere('create', '--collection', 'Pedidos', '--title', 'Lost');
      expect(refused.code).toBe(7);
      expect(refused.err).toContain('pinned to the project other-zzzzzz');
      expect(refused.err).toContain(id);

      const own = cliAt(repo.dir, { OTEA_AGENT: 'claude-b', OTEA_PROJECT_ID: id });
      const made = await own(
        'create',
        '--collection',
        'Pedidos',
        '--title',
        'Kept',
        '--field',
        'Qué necesitas=x',
      );
      expect(made.err).toBe('');
      expect(made.code).toBe(0);
    });

    it('names --as and --check in its usage, beside the profile', async () => {
      const { out } = await otea('connect', '--help');

      expect(out).toContain(
        'otea connect [--as <name>] [--model <id>] [--effort <level>] [--harness <name>] [--role <secretary>] [--check]',
      );
    });

    it('writes AGENTS.md and prints the MCP server to add, writing no harness config', async () => {
      const { code, out } = await otea('connect');

      expect(code).toBe(0);
      expect(read('AGENTS.md')).toBe(`${BLOCK}\n`);
      expect(existsSync(join(repo.dir, '.mcp.json'))).toBe(false);
      expect(out).toContain(`Added the Otea block to ${join(repo.dir, 'AGENTS.md')}`);
      // No harness is said to need an import: only one that does not read AGENTS.md.
      expect(out).toContain("if your harness doesn't read AGENTS.md, import it");
      expect(out).not.toContain('Claude Code reads CLAUDE.md');
      expect(out).toContain(
        "add this MCP server to your harness's MCP config yourself, for this project only",
      );
      expect(out).toContain('never your user or global config');
      // The entry names no agent: each session names itself (restored after P9-F3's cut).
      expect(out).toContain('The entry names no agent: each session names itself');
      expect(out).toMatch(/^ {2}name {5}otea$/m);
      expect(out).toMatch(/^ {2}command {2}node$/m);
      expect(out).toContain(`As JSON: ${JSON.stringify({ otea: entry() })}`);
      // The JSON is one shape among many: the agent translates it or uses its harness's own command,
      // and the usual project files are named as examples only.
      expect(out).toContain("translate it to your harness's schema");
      expect(out).toContain('mcp add');
      expect(out).toContain('Claude Code: .mcp.json');
      expect(out).toContain('OpenCode: opencode.json');
      expect(out).toContain('environment');
      // The shapes of the three harnesses the README documents, as their official docs give them:
      // OpenCode's servers carry a type and a command array; Codex reads TOML; Gemini CLI's
      // settings.json nests them under mcpServers.
      expect(out).toContain(
        'OpenCode: opencode.json (under mcp.servers, with type local, command as one array of the command and its args, and env as environment)',
      );
      expect(out).toContain('Codex: .codex/config.toml (a [mcp_servers.<name>] table)');
      expect(out).toContain('Gemini CLI: .gemini/settings.json (under mcpServers)');
      // p3-company run 2: a restart to load MCP lost the interview the session held.
      expect(out).toContain(
        "If your harness must restart or reload to load the server, ask the person for it now, before you go on, and to reopen this same conversation with your harness's resume option, if it has one, so you keep what was said; Otea keeps every item and board draft either way.",
      );
      expect(out.trimEnd().split('\n').at(-1)).toMatch(/^Then run otea connect --check/);
      // p6: a harness's permission mode blocked git push and git worktree add mid-flow.
      expect(out).toContain(
        "Have your harness allow, for this project: otea (its commands and its MCP tools), git push to the items' branches (Otea's pre-push hook still checks each push) and git worktree add (docs/working-with-agents.md, «What your harness must allow», has examples).",
      );
    });

    // P9-F3: the same thing said three times in a long output, and a PATH warning that alarmed.
    it('says each thing once, in a short output, and the PATH difference as a note, not a warning', async () => {
      const bin = join(repo.dir, 'bin');
      mkdirSync(bin);
      const decoy = join(bin, process.platform === 'win32' ? 'otea.cmd' : 'otea');
      writeFileSync(decoy, '#!/bin/sh\n');
      chmodSync(decoy, 0o755);

      const { out } = await cliAt(repo.dir, { PATH: bin })('connect');

      expect(out.match(/writes no harness config/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(out.match(/for this project only/g)?.length ?? 0).toBe(1);
      expect(out).not.toMatch(/^warning/im);
      expect(out.split('PATH').length - 1).toBe(1);
      // What is required comes last, as one line.
      expect(out.trimEnd().split('\n').at(-1)).toMatch(/^Then run otea connect --check/);
    });

    it('prints the server and what it did with AGENTS.md with --json', async () => {
      expect(await json('connect')).toEqual({
        agentsMd: { path: join(repo.dir, 'AGENTS.md'), action: 'created' },
        mcp: { name: 'otea', ...entry() },
      });
    });

    it('carries an Otea home set apart, so the server finds the same projects', async () => {
      const home = join(repo.dir, 'my home');
      const custom = cliAt(repo.dir, { OTEA_HOME: home });
      await custom('init', '--local');
      const own = JSON.parse((await custom('projects', 'current', '--json')).out).id;

      const { mcp } = JSON.parse((await custom('connect', '--json')).out);

      expect(mcp).toEqual({
        name: 'otea',
        command: 'node',
        args: ['--disable-warning=ExperimentalWarning', MAIN, 'mcp', '--project', own],
        env: { OTEA_HOME: home },
      });
    });

    it('ignores an otea on PATH that is another install: the absolute form, and a note naming it', async () => {
      const bin = join(repo.dir, 'bin');
      mkdirSync(bin);
      const decoy = join(bin, process.platform === 'win32' ? 'otea.cmd' : 'otea');
      writeFileSync(decoy, '#!/bin/sh\n');
      chmodSync(decoy, 0o755);
      const onPath = cliAt(repo.dir, { PATH: bin });

      const { mcp } = JSON.parse((await onPath('connect', '--json')).out);
      const { out } = await onPath('connect');

      expect(mcp).toEqual({ name: 'otea', ...entry() });
      expect(mcp.command).not.toBe('otea');
      expect(mcp.command).not.toBe('cmd');
      expect(isAbsolute(mcp.args.at(-4))).toBe(true);
      // Windows spells the ending as PATHEXT does, in capitals.
      expect(out.toLowerCase()).toContain(
        `note: the otea on your path (${decoy}) is another install`.toLowerCase(),
      );
      expect(out).toContain(MAIN);
    });

    it('says no otea is on PATH when none is, and gives the absolute form', async () => {
      const { out } = await cliAt(repo.dir, { PATH: join(repo.dir, 'nothing') })('connect');

      expect(out).toContain('Note: no otea is on your PATH');
      expect(out).toContain(`As JSON: ${JSON.stringify({ otea: entry() })}`);
    });

    it('prints the otea command when the otea on PATH is this same install, so the config survives a moved checkout', async () => {
      const root = dirname(dirname(dirname(MAIN)));
      const bin = join(repo.dir, 'bin');
      mkdirSync(bin);
      const restore: (() => void)[] = [];
      if (process.platform === 'win32') {
        // npm's shim: a .cmd that runs the package it keeps beside it.
        mkdirSync(join(bin, 'node_modules', '@otea'), { recursive: true });
        symlinkSync(root, join(bin, 'node_modules', '@otea', 'cli'), 'junction');
        writeFileSync(
          join(bin, 'otea.cmd'),
          '@echo off\r\n"%dp0%\\node_modules\\@otea\\cli\\bin\\otea.mjs" %*\r\n',
        );
      } else {
        // npm's link: a symlink to the package's bin, which must be executable to be found.
        const script = join(root, 'bin', 'otea.mjs');
        const mode = statSync(script).mode;
        chmodSync(script, 0o755);
        restore.push(() => chmodSync(script, mode));
        symlinkSync(script, join(bin, 'otea'));
      }
      try {
        const onPath = cliAt(repo.dir, { PATH: bin });

        const { mcp } = JSON.parse((await onPath('connect', '--json')).out);
        const { out } = await onPath('connect');

        // A harness on Windows starts no .cmd shim by itself: cmd /c runs it.
        const command =
          process.platform === 'win32'
            ? { command: 'cmd', args: ['/c', 'otea', 'mcp', '--project', id] }
            : { command: 'otea', args: ['mcp', '--project', id] };
        expect(mcp).toEqual({ name: 'otea', ...command });
        expect(out).toContain(`As JSON: ${JSON.stringify({ otea: command })}`);
        expect(out).not.toContain('Warning:');
      } finally {
        for (const undo of restore) undo();
      }
    });

    it('writes AGENTS.md in the worktree it runs in, not in the main checkout', async () => {
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          cwd: repo.dir,
          stdio: 'ignore',
        });
      git('commit', '--quiet', '--allow-empty', '-m', 'first');
      const tree = join(repo.dir, 'wt');
      git('worktree', 'add', '--quiet', '--detach', tree);

      const { agentsMd } = JSON.parse((await cliAt(tree)('connect', '--json')).out);

      expect(agentsMd).toEqual({ path: join(tree, 'AGENTS.md'), action: 'created' });
      expect(readFileSync(join(tree, 'AGENTS.md'), 'utf8')).toBe(`${BLOCK}\n`);
      expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
    });

    // P8-F8: an agent on the command line only has no use for the MCP server block.
    it.each(['--cli', '--no-mcp'])(
      'prints no MCP server with %s, declares the profile and never makes the desk wait for MCP',
      async (flag) => {
        const { code, out } = await otea('connect', '--as', 'claude-b', ...PROFILE, flag);

        expect(code).toBe(0);
        expect(read('AGENTS.md')).toBe(`${BLOCK}\n`);
        expect(out).toContain(`Added the Otea block to ${join(repo.dir, 'AGENTS.md')}`);
        expect(out).toContain('otea next --as claude-b');
        expect(out).not.toContain('MCP server to add');
        expect(out).not.toContain('PATH');
        expect(out.split('\n').length).toBeLessThanOrEqual(6);
        const { agentsMd, mcp } = JSON.parse(
          (await otea('connect', '--as', 'claude-b', ...PROFILE, flag, '--json')).out,
        );
        expect(agentsMd.action).toBe('unchanged');
        expect(mcp).toBeUndefined();
        // It never asked for MCP: nothing to warn about while no MCP server loads.
        expect(missing('claude-b')).toBeFalsy();
        const profile = JSON.parse(
          (await cliAt(repo.dir, { OTEA_AGENT: 'claude-b' })('profile', '--json')).out,
        );
        expect(profile.profile).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
      },
    );

    it('declares the profile of the agent named, and the desk warns until it is heard over MCP', async () => {
      const { code } = await otea('connect', '--as', 'claude-b', ...PROFILE);

      expect(code).toBe(0);
      expect(missing('claude-b')).toBe(true);
      const profile = JSON.parse(
        (await cliAt(repo.dir, { OTEA_AGENT: 'claude-b' })('profile', '--json')).out,
      );
      expect(profile.profile).toMatchObject({
        model: 'claude-opus-5-5',
        effort: 'high',
        // No harness named: it works through the command line until its MCP client names one.
        harness: 'cli',
      });
    });

    // P8-R2-3: connect after profile --harness opencode reset the harness to cli and left the
    // profile unconfirmed, so next refused with profile_required.
    it('keeps the harness the agent declared, and its profile confirmed when unchanged', async () => {
      const agent = cliAt(repo.dir, { OTEA_AGENT: 'pc' });
      await agent('profile', ...PROFILE, '--harness', 'opencode');

      const { code, out } = await agent('connect', ...PROFILE);

      expect(code).toBe(0);
      const profile = JSON.parse((await agent('profile', '--json')).out);
      expect(profile).toMatchObject({
        profile: { model: 'claude-opus-5-5', effort: 'high', harness: 'opencode' },
        confirmed: true,
      });
      expect(out).not.toContain('not confirmed');
      const next = await agent('next');
      expect(next.err).not.toContain('profile_required');
      expect(next.err).not.toContain('not confirmed in this session');
    });

    // P8-F3: --model and --effort were required, though a harness may not tell the agent either; the
    // agent says unknown then, as otea profile lets it.
    it('declares unknown for the model and effort an agent named does not give', async () => {
      const agent = cliAt(repo.dir, { OTEA_AGENT: 'p8-oc' });

      const { code, err } = await agent('connect', '--as', 'p8-oc', '--harness', 'opencode');

      expect(code).toBe(0);
      expect(err).toBe('');
      expect(JSON.parse((await agent('profile', '--json')).out)).toMatchObject({
        profile: { harness: 'opencode', model: 'unknown', effort: 'unknown' },
        confirmed: false,
      });
    });

    it('keeps the model and effort an agent declared when connect names neither', async () => {
      const agent = cliAt(repo.dir, { OTEA_AGENT: 'pc' });
      await agent('profile', ...PROFILE, '--harness', 'opencode');

      expect((await agent('connect', '--as', 'pc')).code).toBe(0);

      expect(JSON.parse((await agent('profile', '--json')).out)).toMatchObject({
        profile: { model: 'claude-opus-5-5', effort: 'high', harness: 'opencode' },
        confirmed: true,
      });
    });

    it('says unknown for the one of the two it is not given', async () => {
      const { code } = await otea('connect', '--as', 'claude-b', '--model', 'gpt-5');

      expect(code).toBe(0);
      const profile = JSON.parse(
        (await cliAt(repo.dir, { OTEA_AGENT: 'claude-b' })('profile', '--json')).out,
      );
      expect(profile.profile).toMatchObject({ model: 'gpt-5', effort: 'unknown' });
    });

    it('says, with --check, that nobody reached Otea over MCP yet', async () => {
      await otea('connect', '--as', 'claude-b', ...PROFILE);

      const { code, out } = await otea('connect', '--check', '--as', 'claude-b');

      expect(code).toBe(11);
      expect(out).toContain('claude-b has not reached Otea through its MCP server');
      expect(out).toContain('your harness runs another otea server');
      expect((await otea('connect', '--check')).out).toMatch(
        /^No agent has reached Otea through its MCP server/,
      );
    });

    it('says, with --check, that the agent was heard over MCP, and the desk stops warning', async () => {
      await otea('connect', '--as', 'claude-b', ...PROFILE);
      const client = new Client({ name: 'opencode', version: '1.4.0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createMcpServer(COMMANDS, { cwd: repo.dir, warn: () => {} }).connect(serverSide);
      await client.connect(clientSide);
      try {
        const called = await client.callTool({ name: 'list', arguments: { as: 'claude-b' } });
        expect(called.isError).toBeFalsy();
      } finally {
        await client.close();
      }

      const { code, out } = await otea('connect', '--check', '--as', 'claude-b');

      expect(code).toBe(0);
      expect(out).toMatch(
        /^MCP works: claude-b was heard through Otea's MCP server .* \(opencode\)$/m,
      );
      expect(missing('claude-b')).toBe(false);
    });

    it('points at the otea entry an older connect left in .mcp.json', async () => {
      repo.write(
        '.mcp.json',
        JSON.stringify({ mcpServers: { otea: { command: 'node', args: ['mcp', '--as', 'x'] } } }),
      );

      const { out } = await otea('connect');

      expect(out).toContain(
        `${join(repo.dir, '.mcp.json')} still has the otea entry an older otea connect wrote`,
      );
    });

    it.each([
      'Claude',
      'claude b',
      '-claude',
      'claude-',
      'claude--b',
      'a-very-long-agent-name-indeed-beyond-forty',
      'you',
      'human',
    ])('refuses %j with invalid_agent_name', async (name) => {
      const { code, err } = await otea('connect', `--as=${name}`, '--json');

      expect(code).toBe(6);
      expect(JSON.parse(err).error.code).toBe('invalid_agent_name');
      expect(existsSync(join(repo.dir, 'AGENTS.md'))).toBe(false);
    });

    it('fails with not_found before init', async () => {
      const bare = tempGitRepo();
      try {
        expect((await cliAt(bare.dir)('connect', '--as', 'claude', ...PROFILE)).code).toBe(3);
      } finally {
        bare.remove();
      }
    });
  });
});
