import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, publishBoard, saveDraft } from '../app/boards.ts';
import { attachEvidence } from '../app/evidence.ts';
import { sendBackItem } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { creatures } from '../core/board/testing.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import { type Cli, cliAt, declareProfiles, type TempRepo, tempGitRepo } from './testing.ts';

// S2, P1 (final red-team run): `otea update CAM-1 --field "..." --as intruso` rewrote the request of
// an item that waited for the person's review; the desk only warned afterwards. Over the command
// line and over MCP alike, no agent name changes it while the review is open.
describe('an item in the person’s review does not change under any agent name', () => {
  let repo: TempRepo;
  let otea: Cli;
  const as = (name: string) => cliAt(repo.dir, { OTEA_AGENT: name });

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = as('claude');
    await otea('init');
    declareProfiles(repo.dir, 'claude', 'intruso', 'sol');
    const project = openProject(repo.dir);
    try {
      const record = createBoard(project, { name: 'Criaturas', lang: 'es' });
      saveDraft(project, record.id, { definition: creatures(), baseVersion: null });
      publishBoard(project, record.id, { moves: {}, by: { kind: 'human', name: 'fede' } });
    } finally {
      project.db.close();
    }
    await otea(
      'create',
      '--collection',
      'Criaturas',
      '--title',
      'Tortuga',
      '--field',
      'fdesc=Lenta',
    );
    await otea('claim', 'CRI-1');
    const art = join(repo.dir, 'art.png');
    writeFileSync(art, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await otea('attach', 'CRI-1', art, '--module', 'eart');
    const handed = await otea('handoff', 'CRI-1');
    expect(handed.code, handed.err).toBe(0);
  }, 60_000);

  afterEach(() => repo.remove());

  // The request as the item keeps it, read from the record whole.
  const request = async () => {
    const shown = JSON.parse((await otea('show', 'CRI-1', '--json')).out) as {
      fields: { id: string; value: string }[];
    };
    return shown.fields.find(({ id }) => id === 'fdesc')?.value;
  };

  it('refuses an update from any name on the command line, exit 7, and leaves the request', async () => {
    for (const name of ['intruso', 'claude']) {
      const refused = await as(name)('update', 'CRI-1', '--field', 'fdesc=Rápida');

      expect(refused.code, refused.err).toBe(7);
      expect(refused.err).toContain("CRI-1 waits for the person's review");
    }
    expect(await request()).toBe('Lenta');
  });

  it('points the secretary to the card that sends it back', async () => {
    await as('sol')('profile', '--role', 'secretary');

    const refused = await as('sol')('update', 'CRI-1', '--field', 'fdesc=Rápida');

    expect(refused.code, refused.err).toBe(7);
    expect(refused.err).toContain('--send-back CRI-1');
    expect(await request()).toBe('Lenta');
  });

  it('refuses it over MCP too', async () => {
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, warn: () => {} });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    try {
      const reply = (await client.callTool({
        name: 'update',
        arguments: { id: 'CRI-1', field: ['fdesc=Rápida'], as: 'intruso' },
      })) as { isError?: boolean; content: { text: string }[] };

      expect(reply.isError).toBe(true);
      expect(reply.content[0]?.text).toContain("CRI-1 waits for the person's review");
    } finally {
      await client.close();
    }
    expect(await request()).toBe('Lenta');
  });

  // The files of the delivery are what the person reviews: the same hold as for the request, on any
  // step (not only one that pushes the protected branch).
  const files = async () =>
    (JSON.parse((await otea('show', 'CRI-1', '--json')).out) as { evidence: unknown[] }).evidence
      .length;
  const another = () => {
    const path = join(repo.dir, 'other.png');
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
    return path;
  };

  it('refuses an attach from any name on the command line, exit 7, and adds no file', async () => {
    for (const name of ['intruso', 'claude']) {
      const refused = await as(name)('attach', 'CRI-1', another(), '--module', 'eart');

      expect(refused.code, refused.err).toBe(7);
      expect(refused.err).toContain("CRI-1 waits for the person's review");
    }
    expect(await files()).toBe(1);
  });

  it('points the secretary to the card that sends it back when it attaches', async () => {
    await as('sol')('profile', '--role', 'secretary');

    const refused = await as('sol')('attach', 'CRI-1', another(), '--module', 'eart');

    expect(refused.code, refused.err).toBe(7);
    expect(refused.err).toContain('--send-back CRI-1');
    expect(await files()).toBe(1);
  });

  it('refuses an attach over MCP too', async () => {
    const server = createMcpServer(COMMANDS, { cwd: repo.dir, warn: () => {} });
    const client = new Client({ name: 'test', version: '0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    try {
      const reply = (await client.callTool({
        name: 'attach',
        arguments: { id: 'CRI-1', file: another(), module: 'eart', as: 'intruso' },
      })) as { isError?: boolean; content: { text: string }[] };

      expect(reply.isError).toBe(true);
      expect(reply.content[0]?.text).toContain("CRI-1 waits for the person's review");
    } finally {
      await client.close();
    }
    expect(await files()).toBe(1);
  });

  it('lets the person attach on the desk, and an agent again once it is back with the worker', async () => {
    const project = openProject(repo.dir);
    try {
      attachEvidence(project, {
        id: 'CRI-1',
        path: another(),
        module: 'eart',
        actor: { kind: 'human', name: 'human' },
        channel: 'ui',
      });
      sendBackItem(
        project,
        { id: 'CRI-1', actor: { kind: 'human', name: 'human' }, channel: 'ui', reason: 'again' },
        () => new Date().toISOString(),
      );
    } finally {
      project.db.close();
    }
    expect(await files()).toBe(2);

    const attached = await as('claude')('attach', 'CRI-1', another(), '--module', 'eart');

    expect(attached.code, attached.err).toBe(0);
  });

  it('lets an agent change the request again once it is back with the worker', async () => {
    const project = openProject(repo.dir);
    try {
      sendBackItem(
        project,
        { id: 'CRI-1', actor: { kind: 'human', name: 'human' }, channel: 'ui', reason: 'again' },
        () => new Date().toISOString(),
      );
    } finally {
      project.db.close();
    }

    const changed = await as('claude')('update', 'CRI-1', '--field', 'fdesc=Rápida');

    expect(changed.code, changed.err).toBe(0);
    expect(await request()).toBe('Rápida');
  });
});
