import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdAgentHome } from '../app/agent-home.ts';
import { openRegistry } from '../app/home.ts';
import { systemClock } from '../app/items.ts';
import { openProject } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  presetCollection,
  spawnCli,
  tempGitRepo,
} from './testing.ts';

type Repo = ReturnType<typeof tempGitRepo>;

// The field study's worst finding: two projects of one person both had a CAM-1, an agent of one
// ran a command from a folder of the other, and Otea chose the project by folder and took it. An
// agent belongs to the project it works in while it is there: a command of it on another project's
// items is refused, wherever the agent stands.
describe('an agent belongs to the project it works in', () => {
  let a: Repo;
  let b: Repo;
  // A name of its own for each test: a project's data stays in the Otea home when its folder goes,
  // and an agent that worked there a moment ago would still be at work in it.
  let me = '';
  let counter = 0;

  // Two projects in the one Otea home, each with its own TASKS-1.
  const person = (dir: string): Cli =>
    cliAt(
      dir,
      {},
      new AbortController().signal,
      async () => {},
      undefined,
      undefined,
      true,
      {},
      true,
    );
  const agent = (dir: string, name: string): Cli => cliAt(dir, { OTEA_AGENT: name });

  const nameOf = (dir: string): string => {
    const project = openProject(dir);
    try {
      return project.identity.name;
    } finally {
      project.db.close();
    }
  };
  const idOf = (dir: string): string => {
    const project = openProject(dir);
    try {
      return project.identity.id;
    } finally {
      project.db.close();
    }
  };
  const titleIn = (dir: string, id: string): string => {
    const project = openProject(dir);
    try {
      return (
        project.db.prepare('SELECT title FROM items WHERE id = ?').get(id) as { title: string }
      ).title;
    } finally {
      project.db.close();
    }
  };
  const holderIn = (dir: string, id: string): string | null => {
    const project = openProject(dir);
    try {
      return (
        project.db.prepare('SELECT lease_holder AS h FROM items WHERE id = ?').get(id) as {
          h: string | null;
        }
      ).h;
    } finally {
      project.db.close();
    }
  };
  // The agent has been silent for `minutes`: the home the Otea home keeps for it was last kept
  // that long ago (what its calls in its own project keep fresh).
  const silentFor = (name: string, minutes: number) => {
    const registry = openRegistry();
    try {
      const past = new Date(Date.now() - minutes * 60_000).toISOString();
      registry.prepare('UPDATE agent_homes SET at = ? WHERE name = ?').run(past, name);
    } finally {
      registry.close();
    }
  };

  beforeEach(async () => {
    me = `worker-${++counter}`;
    a = tempGitRepo();
    b = tempGitRepo();
    for (const [dir, label] of [
      [a.dir, 'game'],
      [b.dir, 'sets'],
    ] as const) {
      await cliAt(dir)('init');
      presetCollection(dir, 'tasks');
      declareProfiles(dir, me);
      expect(
        (await person(dir)('create', '--collection', 'tasks', '--title', `${label} task`)).code,
      ).toBe(0);
    }
  });

  afterEach(() => {
    a.remove();
    b.remove();
  });

  it("refuses its command on the item of another project, from that project's folder", async () => {
    expect((await agent(a.dir, me)('claim', 'TASKS-1')).code).toBe(0);

    const refused = await agent(b.dir, me)('update', 'TASKS-1', '--title', 'game branch');

    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain(me);
    expect(refused.err).toContain(nameOf(a.dir));
    expect(refused.err).toContain('nothing was written');
    // It says where to run it, never to take another name: the name is the agent's.
    expect(refused.err).toContain('otea projects current');
    expect(refused.err).not.toContain('whoami');
    expect(refused.err).not.toContain('name of your own');
    expect(titleIn(b.dir, 'TASKS-1')).toBe('sets task');
    expect(titleIn(a.dir, 'TASKS-1')).toBe('game task');
  });

  it('refuses a claim there too, lets it read, and never notes it as seen in that project', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');

    expect((await agent(b.dir, me)('claim', 'TASKS-1')).code).not.toBe(0);
    // A read goes through with a warning that it shows another project's items.
    const read = await agent(b.dir, me)('show', 'TASKS-1');
    expect(read.code).toBe(0);
    expect(read.err).toContain(`${me} works in the project ${nameOf(a.dir)}`);

    expect(holderIn(b.dir, 'TASKS-1')).toBeNull();
    const project = openProject(b.dir);
    try {
      const events = project.db
        .prepare('SELECT count(*) AS n FROM events WHERE actor_name = ?')
        .get(me) as { n: number };
      expect(events.n).toBe(0);
      const row = project.db.prepare('SELECT acted_at FROM agents WHERE name = ?').get(me) as {
        acted_at: string | null;
      };
      expect(row.acted_at).toBeNull();
    } finally {
      project.db.close();
    }
  });

  it('keeps working from its own project, and its own folder is not the only way in', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    await agent(b.dir, me)('update', 'TASKS-1', '--title', 'stray');

    const own = await agent(a.dir, me)('update', 'TASKS-1', '--title', 'game task, edited');

    expect(own.err).toBe('');
    expect(own.code).toBe(0);
    expect(titleIn(a.dir, 'TASKS-1')).toBe('game task, edited');
    // From a subfolder of its own project, as from the root.
    a.write('src/x.txt', '');
    expect((await agent(`${a.dir}/src`, me)('show', 'TASKS-1')).code).toBe(0);
  });

  it('refuses it over MCP from the folder of another project, and serves it in its own', async () => {
    const serve = async (cwd: string, as: string) => {
      const server = createMcpServer(COMMANDS, { cwd, agent: as, json: true, warn: () => {} });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      return client;
    };
    const inA = await serve(a.dir, me);
    const inB = await serve(b.dir, me);
    try {
      const own = (await inA.callTool({
        name: 'claim',
        arguments: { id: 'TASKS-1' },
      })) as { isError?: boolean };
      expect(own.isError).toBeFalsy();

      const stray = (await inB.callTool({
        name: 'update',
        arguments: { id: 'TASKS-1', title: 'from the game' },
      })) as { isError?: boolean; content: { text: string }[] };

      expect(stray.isError).toBe(true);
      expect(stray.content[0]?.text).toContain('nothing was written');
      expect(titleIn(b.dir, 'TASKS-1')).toBe('sets task');
    } finally {
      await inA.close();
      await inB.close();
    }
  });

  it("leaves the person alone in both projects, and each project's own agents too", async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    await agent(b.dir, me)('update', 'TASKS-1', '--title', 'stray');
    // The person reads and writes in either project as before.
    expect((await person(b.dir)('show', 'TASKS-1')).code).toBe(0);
    expect(
      (await person(b.dir)('create', '--collection', 'tasks', '--title', 'another')).code,
    ).toBe(0);
    expect(
      (await person(a.dir)('create', '--collection', 'tasks', '--title', 'another')).code,
    ).toBe(0);
    // Another agent of project B is no one's concern.
    declareProfiles(b.dir, 'worker-b');
    expect((await agent(b.dir, 'worker-b')('claim', 'TASKS-1')).code).toBe(0);
  });

  // A session boundary is an hour of silence (CLI_SESSION_GAP_MS), not a quiet moment: a worker
  // busy on a long step makes no otea call for minutes and is still the project's.
  it('keeps the home through a quiet few minutes', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    silentFor(me, 3);

    const there = await agent(b.dir, me)('update', 'TASKS-1', '--title', 'stray');

    expect(there.code).not.toBe(0);
    expect(titleIn(b.dir, 'TASKS-1')).toBe('sets task');
    silentFor(me, 59);
    expect((await agent(b.dir, me)('update', 'TASKS-1', '--title', 'stray')).code).not.toBe(0);
  });

  it('lets the name go after an hour of silence, and takes it to its new project', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    silentFor(me, 61);

    const there = await agent(b.dir, me)('update', 'TASKS-1', '--title', 'new place');

    expect(there.code).toBe(0);
    expect(titleIn(b.dir, 'TASKS-1')).toBe('new place');
    // It is now at work in B: the same name does not reach A.
    const back = await agent(a.dir, me)('update', 'TASKS-1', '--title', 'stray');
    expect(back.code).not.toBe(0);
    expect(titleIn(a.dir, 'TASKS-1')).toBe('game task');
  });

  // Only a write binds: reading from the folder of another project never moves the home.
  it('never rebinds on a read, however long the agent was silent', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    silentFor(me, 120);

    expect((await agent(b.dir, me)('show', 'TASKS-1')).code).toBe(0);

    // Still homed in A: the read changed nothing.
    const registry = openRegistry();
    try {
      const home = registry
        .prepare('SELECT project_id FROM agent_homes WHERE name = ?')
        .get(me) as {
        project_id: string;
      };
      expect(home.project_id).toBe(idOf(a.dir));
    } finally {
      registry.close();
    }
  });

  it('lets a new harness session take the name at once, and refuses the same one', async () => {
    const inA = openProject(a.dir);
    const inB = openProject(b.dir);
    try {
      holdAgentHome(inA, me, 'write', process.env, systemClock, 1111);
      // Another session of the harness (another launcher) starting in B takes it...
      expect(() => holdAgentHome(inB, me, 'write', process.env, systemClock, 1111)).toThrow(
        /works in the project/,
      );
      expect(holdAgentHome(inB, me, 'write', process.env, systemClock, 2222)).toBeUndefined();
      // ...and now that session is B's: A refuses it.
      expect(() => holdAgentHome(inA, me, 'write', process.env, systemClock, 2222)).toThrow(
        /works in the project/,
      );
    } finally {
      inA.db.close();
      inB.db.close();
    }
  });

  it('is refused for a connect and a profile too, but whoami stays a read', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');

    const connected = await agent(b.dir, me)(
      'connect',
      '--cli',
      '--model',
      'm',
      '--effort',
      'high',
    );
    expect(connected.code).not.toBe(0);
    expect(connected.err).toContain('nothing was written');
    const profiled = await agent(b.dir, me)('profile', '--model', 'm', '--effort', 'high');
    expect(profiled.code).not.toBe(0);
    expect((await agent(b.dir, me)('whoami')).code).toBe(0);
  });

  // The check and the binding are one step: two first calls of one name, from two projects at the
  // same moment, never both get in.
  it('lets only one of two first calls racing from two projects in', async () => {
    const racer = `racer-${++counter}`;
    const calls = await Promise.all([
      spawnCli(a.dir, 'update', 'TASKS-1', '--title', 'from a', '--as', racer),
      spawnCli(b.dir, 'update', 'TASKS-1', '--title', 'from b', '--as', racer),
    ]);

    expect(calls.map(({ code }) => code).sort()).toEqual([0, 7]);
    const written = [
      titleIn(a.dir, 'TASKS-1') === 'from a',
      titleIn(b.dir, 'TASKS-1') === 'from b',
    ];
    expect(written.filter(Boolean)).toHaveLength(1);
  });

  // When Otea cannot tell which project the name works in, it does not guess: it asks to try again.
  it('refuses and asks to try again when the home cannot be read', () => {
    const inA = openProject(a.dir);
    try {
      const broken = { OTEA_HOME: join(a.dir, 'not-a-folder') };
      writeFileSync(broken.OTEA_HOME, 'a file where the Otea home should be');
      expect(() => holdAgentHome(inA, me, 'write', broken)).toThrow(/try again/);
    } finally {
      inA.db.close();
    }
  });

  it('holds for projects that keep their data in their own folder too', async () => {
    const c = tempGitRepo();
    const d = tempGitRepo();
    try {
      for (const [dir, label] of [
        [c.dir, 'local one'],
        [d.dir, 'local two'],
      ] as const) {
        await cliAt(dir)('init', '--local');
        presetCollection(dir, 'tasks');
        declareProfiles(dir, me);
        await person(dir)('create', '--collection', 'tasks', '--title', `${label} task`);
      }
      expect((await agent(c.dir, me)('claim', 'TASKS-1')).code).toBe(0);

      const refused = await agent(d.dir, me)('update', 'TASKS-1', '--title', 'stray');

      expect(refused.code).not.toBe(0);
      expect(titleIn(d.dir, 'TASKS-1')).toBe('local two task');
    } finally {
      c.remove();
      d.remove();
    }
  });
});
