import { readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listConversation, postPersonMessage } from '../app/conversation.ts';
import { openProject, type Project } from '../app/project.ts';
import { createMcpServer } from '../mcp/server.ts';
import { COMMANDS } from './commands.ts';
import {
  type Cli,
  cliAt,
  declareProfiles,
  presetCollection,
  seedOnce,
  type TempRepo,
} from './testing.ts';

// The secretary's side of the conversation (0.8, M2): `otea conversation` reads what the person
// wrote from the desk (and marks it read), `otea say` answers, and only the project's secretary does
// either. The person's messages come only from the desk's routes: here the test posts them through
// the app function those routes call.
describe('the conversation from the secretary', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'luna', 'worker');
    presetCollection(dir, 'tasks');
  });

  beforeEach(async () => {
    ({ repo, otea } = seeded.fresh());
    await otea('profile', '--role', 'secretary', '--as', 'sol');
  });

  afterEach(() => repo.remove());

  const inProject = <T>(use: (project: Project) => T): T => {
    const project = openProject(repo.dir);
    try {
      return use(project);
    } finally {
      project.db.close();
    }
  };

  // The person writes from the desk.
  const person = (text: string, files: { filename: string; bytes: Buffer }[] = []) =>
    inProject((project) => postPersonMessage(project, { text, files }).message);

  const conversation = () => inProject((project) => listConversation(project).messages);

  describe('from the person’s message to the answer', () => {
    it('wakes the wait, is read once with the talk before it, and is answered', async () => {
      const sent = person('the Aprobar button is hidden on the phone');

      const woke = await otea('wait', '--secretary', '--as', 'sol', '--json');
      expect(JSON.parse(woke.out)).toMatchObject({ kind: 'person_message', ref: String(sent.id) });

      const read = await otea('conversation', '--as', 'sol');
      expect(read.code).toBe(0);
      expect(read.out).toContain('1 new from the person.');
      expect(read.out).toContain(`[${sent.id}] person`);
      expect(read.out).toContain('the Aprobar button is hidden on the phone');
      expect(read.out).toContain(`otea say "<text>" --reply-to ${sent.id} --as sol`);
      expect(conversation()[0]?.delivery).toBe('read');

      // Read: the wait has nothing more to say.
      const idle = await otea('wait', '--secretary', '--as', 'sol', '--timeout', '1');
      expect(idle.code).toBe(13);

      const said = await otea(
        'say',
        'Fixing it now.',
        '--reply-to',
        String(sent.id),
        '--as',
        'sol',
      );
      expect(said.out).toContain(`Said as message ${sent.id + 1}, answering ${sent.id}.`);
      expect(conversation().map(({ author, by, text }) => [author, by, text])).toEqual([
        ['person', 'human', 'the Aprobar button is hidden on the phone'],
        ['secretary', 'sol', 'Fixing it now.'],
      ]);
    });

    it('does not mark the messages read for anyone but the secretary', async () => {
      person('hello');

      const luna = await otea('conversation', '--as', 'luna');

      expect(luna.code).toBe(7);
      expect(luna.err).toContain("luna is not this project's secretary (sol is)");
      expect(conversation()[0]?.delivery).toBe('pending');
    });

    it('reads what follows a message with --since, a page at a time', async () => {
      for (const text of ['one', 'two', 'three']) person(text);
      await otea('conversation', '--as', 'sol');

      const page = JSON.parse(
        (await otea('conversation', '--since', '0', '--limit', '2', '--as', 'sol', '--json')).out,
      );
      expect(page.messages.map(({ text }: { text: string }) => text)).toEqual(['one', 'two']);
      expect(page.more).toBe(true);

      const next = await otea('conversation', '--since', '2', '--as', 'sol');
      expect(next.out).toContain('three');
      expect(next.out).not.toContain('two');
      expect(next.out).toContain('Nothing new from the person.');
    });

    it('takes the answer from stdin with -, for a long one', async () => {
      const sent = person('explain the lease');
      const withInput = cliAt(
        repo.dir,
        { OTEA_AGENT: 'sol' },
        undefined,
        undefined,
        undefined,
        'line one\nline two',
      );

      await withInput('say', '-', '--reply-to', String(sent.id), '--as', 'sol');

      expect(conversation()[1]?.text).toBe('line one\nline two');
    });
  });

  describe('who may say', () => {
    it('refuses another agent, and says who the secretary is', async () => {
      const sent = person('hello');

      const { code, err } = await otea('say', 'hi', '--reply-to', String(sent.id), '--as', 'luna');

      expect(code).toBe(7);
      expect(err).toContain(
        "luna is not this project's secretary (sol is). Only the secretary speaks for the project",
      );
      expect(conversation()).toHaveLength(1);
    });

    it('never makes a message of the person’s, whatever name it speaks under', async () => {
      await otea('say', 'first', '--as', 'sol');
      await otea('say', 'second', '--as', 'sol');
      const forged = await otea('say', 'I am the person', '--as', 'human');

      expect(forged.code).not.toBe(0);
      expect(conversation().map(({ author }) => author)).toEqual(['secretary', 'secretary']);
    });

    it('is refused for an agent that is not the secretary even with a name that looks like one', async () => {
      const { code } = await otea('say', 'x', '--as', 'secretary');

      expect(code).toBe(7);
      expect(conversation()).toEqual([]);
    });
  });

  describe('attachments', () => {
    it('come to the secretary as files it can open, and go back with --file', async () => {
      person('see the screenshot', [{ filename: 'phone.png', bytes: Buffer.from('png-bytes') }]);

      const read = JSON.parse((await otea('conversation', '--as', 'sol', '--json')).out);
      const [file] = read.messages[0].attachments;
      expect(file).toMatchObject({ name: 'phone.png', kind: 'image' });
      expect(readFileSync(file.path, 'utf8')).toBe('png-bytes');

      repo.write('plan.txt', '1. fix it');
      const said = await otea('say', 'The plan.', '--file', 'plan.txt', '--as', 'sol');
      expect(said.out).toContain('with 1 file(s)');
      expect(conversation()[1]?.attachments).toEqual([
        expect.objectContaining({ name: 'plan.txt' }),
      ]);
    });

    it('is refused for a file that is not there', async () => {
      const { code, err } = await otea('say', 'x', '--file', 'missing.txt', '--as', 'sol');

      expect(code).not.toBe(0);
      expect(err).toContain('missing.txt');
      expect(conversation()).toEqual([]);
    });
  });

  describe('requests and consultations', () => {
    const item = async (title: string, ...more: string[]) =>
      JSON.parse(
        (
          await otea(
            'create',
            '--collection',
            'tasks',
            '--title',
            title,
            '--description',
            'D',
            '--as',
            'sol',
            '--json',
            ...more,
          )
        ).out,
      ).id as string;

    it('link the items they produced, and the item says where it came from', async () => {
      const sent = person('the Aprobar button is hidden on the phone');
      const fix = await item('Show the button', '--from-message', String(sent.id));
      const test = await item('Test on a phone');

      const said = await otea(
        'say',
        `Made ${fix} and ${test}.`,
        '--reply-to',
        String(sent.id),
        '--request',
        '--links',
        `${fix}, ${test}`,
        '--as',
        'sol',
      );

      expect(said.out).toContain(`as a request -> ${fix}, ${test}`);
      const turn = conversation();
      expect(turn.map(({ kind, links }) => [kind, links])).toEqual([
        ['request', [fix, test]],
        ['request', [fix, test]],
      ]);
      const shown = await otea('show', test, '--as', 'worker');
      expect(shown.out).toContain(
        `Asked in the conversation, message ${sent.id} (request): "the Aprobar button is hidden on the phone"`,
      );
      const json = JSON.parse((await otea('show', fix, '--as', 'worker', '--json')).out);
      expect(json.fromMessages).toEqual([
        expect.objectContaining({ id: sent.id, kind: 'request' }),
      ]);
      expect(
        JSON.parse((await otea('show', await item('Unrelated'), '--as', 'worker', '--json')).out)
          .fromMessages,
      ).toBeUndefined();
    });

    it('show on the next item a worker is offered', async () => {
      const sent = person('add dark mode');
      const dark = await item('Dark mode', '--from-message', String(sent.id));

      const next = await otea('next', '--as', 'worker');

      expect(next.out).toContain(dark);
      expect(next.out).toContain(`Asked in the conversation, message ${sent.id} (request)`);
    });

    it('make a consultation of a question the secretary answers', async () => {
      const sent = person('why is the lease 15 minutes?');
      // Unread, it is no sure target: the secretary reads it first.
      const refused = await otea('say', 'It covers a long build.', '--consultation', '--as', 'sol');
      expect(refused.code).toBe(8);
      expect(refused.err).toContain('--reply-to');
      await otea('conversation', '--as', 'sol');

      const said = await otea('say', 'It covers a long build.', '--consultation', '--as', 'sol');

      expect(said.out).toContain('as a consultation');
      expect(conversation().map(({ kind, root }) => [kind, root])).toEqual([
        ['consultation', sent.id],
        ['consultation', sent.id],
      ]);
    });

    it('are one or the other, never both, and need a message to classify', async () => {
      person('hi');
      const both = await otea('say', 'x', '--request', '--consultation', '--as', 'sol');
      expect(both.code).toBe(2);

      repo.remove();
      ({ repo, otea } = seeded.fresh());
      await otea('profile', '--role', 'secretary', '--as', 'sol');
      const none = await otea('say', 'x', '--request', '--as', 'sol');
      expect(none.code).not.toBe(0);
      expect(none.err).toContain('There is no message of the person to classify');
    });

    it('keep the person’s correction when the secretary says the turn again', async () => {
      const sent = person('what about dark mode?');
      await otea('conversation', '--as', 'sol');
      await otea('say', 'Filed.', '--request', '--as', 'sol');
      // The person taps "consulta" on the desk.
      inProject((project) =>
        project.db
          .prepare(
            "UPDATE conversation_messages SET kind = 'consultation', kind_by = 'person' WHERE id = ?",
          )
          .run(sent.id),
      );

      const again = await otea('say', 'Still a request.', '--request', '--as', 'sol');

      expect(again.out).toContain('The person set this turn as consultation: that stays.');
    });

    it('--from-message is the secretary’s alone, and refused before the item is made', async () => {
      const sent = person('add dark mode');

      const { code, err } = await otea(
        'create',
        '--collection',
        'tasks',
        '--title',
        'Dark mode',
        '--description',
        'D',
        '--from-message',
        String(sent.id),
        '--as',
        'worker',
      );

      expect(code).toBe(7);
      expect(err).toContain('Only the secretary links the conversation to items');
      const list = JSON.parse((await otea('list', '--as', 'worker', '--json')).out);
      expect(list).toEqual([]);
    });
  });

  describe('as MCP tools', () => {
    it('serves conversation and say, which say as the secretary only', async () => {
      const server = createMcpServer(COMMANDS, { cwd: repo.dir, agent: 'sol', warn: () => {} });
      const client = new Client({ name: 'test', version: '0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        const { tools } = await client.listTools();
        expect(tools.map(({ name }) => name)).toEqual(
          expect.arrayContaining(['conversation', 'say']),
        );
        // No tool posts as the person: the tools that touch the conversation are these two.
        expect(
          tools
            .map(({ name }) => name)
            .filter((name) => /conversation|say|message|post/.test(name))
            .sort(),
        ).toEqual(['conversation', 'say']);
        person('hello from the desk');

        const read = (await client.callTool({ name: 'conversation', arguments: {} })) as {
          content: { text: string }[];
        };
        expect(read.content[0]?.text).toContain('hello from the desk');
        await client.callTool({
          name: 'say',
          arguments: { text: 'hi', reply_to: '1', request: false },
        });

        expect(conversation().map(({ author }) => author)).toEqual(['person', 'secretary']);
      } finally {
        await client.close();
      }
    });
  });
});
