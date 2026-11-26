import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, declareProfiles, presetCollection, tempGitRepo } from './testing.ts';

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
  // The agent stopped: nothing runs for it and it acted a while ago.
  const stopped = (dir: string, name: string) => {
    const project = openProject(dir);
    try {
      const past = new Date(Date.now() - 20 * 60_000).toISOString();
      project.db
        .prepare('UPDATE agents SET last_seen = ?, acted_at = ? WHERE name = ?')
        .run(past, past, name);
      project.db.prepare('UPDATE items SET lease_holder = NULL, lease_expires_at = NULL').run();
    } finally {
      project.db.close();
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
    expect(titleIn(b.dir, 'TASKS-1')).toBe('sets task');
    expect(titleIn(a.dir, 'TASKS-1')).toBe('game task');
  });

  it('refuses a claim and a read-with-a-name there too, and leaves no trace of the agent', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');

    expect((await agent(b.dir, me)('claim', 'TASKS-1')).code).not.toBe(0);
    expect((await agent(b.dir, me)('show', 'TASKS-1')).code).not.toBe(0);

    expect(holderIn(b.dir, 'TASKS-1')).toBeNull();
    const project = openProject(b.dir);
    try {
      const events = project.db
        .prepare('SELECT count(*) AS n FROM events WHERE actor_name = ?')
        .get(me) as { n: number };
      expect(events.n).toBe(0);
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

  it('lets the name go once the agent stopped, and takes it to its new project', async () => {
    await agent(a.dir, me)('claim', 'TASKS-1');
    stopped(a.dir, me);

    const there = await agent(b.dir, me)('update', 'TASKS-1', '--title', 'new place');

    expect(there.code).toBe(0);
    expect(titleIn(b.dir, 'TASKS-1')).toBe('new place');
    // It is now at work in B: the same name does not reach A.
    const back = await agent(a.dir, me)('update', 'TASKS-1', '--title', 'stray');
    expect(back.code).not.toBe(0);
    expect(titleIn(a.dir, 'TASKS-1')).toBe('game task');
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
