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

// The assistant's side of the conversation (0.8, M2): `otea conversation` reads what the person
// wrote from the desk (and marks it read), `otea say` answers, and only the project's assistant does
// either. The person's messages come only from the desk's routes: here the test posts them through
// the app function those routes call.
describe('the conversation from the assistant', () => {
  let repo: TempRepo;
  let otea: Cli;

  const seeded = seedOnce(async (_cli, dir) => {
    declareProfiles(dir, 'sol', 'luna', 'worker');
    presetCollection(dir, 'tasks');
  });

  beforeEach(async () => {
    ({ repo, otea } = seeded.fresh());
    await otea('profile', '--role', 'assistant', '--as', 'sol');
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

      const woke = await otea('wait', '--assistant', '--as', 'sol', '--json');
      expect(JSON.parse(woke.out)).toMatchObject({ kind: 'person_message', ref: String(sent.id) });

      const read = await otea('conversation', '--as', 'sol');
      expect(read.code).toBe(0);
      expect(read.out).toContain('1 new from the person.');
      expect(read.out).toContain(`[${sent.id}] person`);
      expect(read.out).toContain('the Aprobar button is hidden on the phone');
      expect(read.out).toContain(`otea say "<text>" --reply-to ${sent.id} --as sol`);
      expect(conversation()[0]?.delivery).toBe('read');

      // Read is not answered: a wait that begins now brings the message back, saying it was read.
      const again = await otea('wait', '--assistant', '--as', 'sol', '--json');
      expect(JSON.parse(again.out)).toMatchObject({ kind: 'person_message', ref: String(sent.id) });
      expect(JSON.parse(again.out).text).toContain('already read');

      const said = await otea(
        'say',
        'Fixing it now.',
        '--reply-to',
        String(sent.id),
        '--as',
        'sol',
      );
      expect(said.out).toContain(`Said as message ${sent.id + 1}, answering ${sent.id}.`);
      // Answered: the wait has nothing more to say.
      const idle = await otea('wait', '--assistant', '--as', 'sol', '--timeout', '1');
      expect(idle.code).toBe(13);
      expect(conversation().map(({ author, by, text }) => [author, by, text])).toEqual([
        ['person', 'human', 'the Aprobar button is hidden on the phone'],
        ['assistant', 'sol', 'Fixing it now.'],
      ]);
    });

    it('does not mark the messages read for anyone but the assistant', async () => {
      person('hello');

      const luna = await otea('conversation', '--as', 'luna');

      expect(luna.code).toBe(7);
      expect(luna.err).toContain("luna is not this project's assistant (sol is)");
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
    it('refuses another agent, and says who the assistant is', async () => {
      const sent = person('hello');

      const { code, err } = await otea('say', 'hi', '--reply-to', String(sent.id), '--as', 'luna');

      expect(code).toBe(7);
      expect(err).toContain(
        "luna is not this project's assistant (sol is). Only the assistant speaks for the project",
      );
      expect(conversation()).toHaveLength(1);
    });

    it('never makes a message of the person’s, whatever name it speaks under', async () => {
      await otea('say', 'first', '--as', 'sol');
      await otea('say', 'second', '--as', 'sol');
      const forged = await otea('say', 'I am the person', '--as', 'human');

      expect(forged.code).not.toBe(0);
      expect(conversation().map(({ author }) => author)).toEqual(['assistant', 'assistant']);
    });

    it('is refused for an agent that is not the assistant even with a name that looks like one', async () => {
      const { code } = await otea('say', 'x', '--as', 'assistant');

      expect(code).toBe(7);
      expect(conversation()).toEqual([]);
    });
  });

  describe('attachments', () => {
    it('come to the assistant as files it can open, and go back with --file', async () => {
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

    // Git Bash writes the drive D: as /d/...: its own commands print paths that way, and with
    // MSYS_NO_PATHCONV=1 (which Otea's agent text tells an agent to set) they reach otea as typed,
    // where a plain resolve makes them D:\d\... (field study 4, T1c).
    const onWindows = it.skipIf(process.platform !== 'win32');
    onWindows('takes a /d/... path of Git Bash as the file on D:', async () => {
      repo.write('plan.txt', '1. fix it');
      const drive = repo.dir[0] as string;
      const msys = `/${drive.toLowerCase()}${repo.dir.slice(2).replaceAll('\\', '/')}/plan.txt`;

      const said = await otea('say', 'The plan.', '--file', msys, '--as', 'sol');

      expect(said.err).toBe('');
      expect(said.out).toContain('with 1 file(s)');
      expect(conversation()[0]?.attachments).toEqual([
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

    // Field study 7: the photo the person sent never reached the worker.
    it('carry the photo the person sent to the item made from the message, and say where to open it', async () => {
      const sent = person('the button looks wrong, see the photo', [
        { filename: 'phone.png', bytes: Buffer.from('png-bytes') },
      ]);
      const fix = await item('Show the button', '--from-message', String(sent.id));

      const shown = await otea('show', fix, '--as', 'worker');
      expect(shown.out).toContain(
        '1 file the person sent is attached to this item as evidence: open it from the paths listed under Evidence.',
      );
      const json = JSON.parse((await otea('show', fix, '--as', 'worker', '--json')).out);
      const [file] = json.evidence;
      expect(file).toMatchObject({ filename: 'phone.png', kind: 'image' });
      expect(readFileSync(file.path, 'utf8')).toBe('png-bytes');
    });

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

    it('make a consultation of a question the assistant answers', async () => {
      const sent = person('why is the lease 15 minutes?');
      // Unread, it is no sure target: the assistant reads it first.
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
      await otea('profile', '--role', 'assistant', '--as', 'sol');
      const none = await otea('say', 'x', '--request', '--as', 'sol');
      expect(none.code).not.toBe(0);
      expect(none.err).toContain('There is no message of the person to classify');
    });

    it('keep the person’s correction when the assistant says the turn again', async () => {
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

    it('a say with no --reply-to is a notice: its --links are its own and the person’s turns keep their kind and links', async () => {
      const sent = person('retries with backoff?');
      await otea('conversation', '--as', 'sol');
      await otea(
        'say',
        'A design question.',
        '--reply-to',
        String(sent.id),
        '--consultation',
        '--as',
        'sol',
      );
      const fix = await item('Retry with backoff');

      const notice = await otea(
        'say',
        `${fix} is ready for your review.`,
        '--links',
        fix,
        '--as',
        'sol',
      );

      expect(notice.code).toBe(0);
      expect(
        conversation().map(({ author, kind, links, replyTo }) => [author, kind, links, replyTo]),
      ).toEqual([
        ['person', 'consultation', [], null],
        ['assistant', 'consultation', [], sent.id],
        ['assistant', null, [fix], null],
      ]);
      const shown = JSON.parse((await otea('show', fix, '--as', 'worker', '--json')).out);
      expect(shown.fromMessages).toBeUndefined();
    });

    it('a question with --option and --recommend comes with buttons, and is refused with a bad count', async () => {
      person('is a boss on floor 3 a good idea?');
      await otea('conversation', '--as', 'sol');

      const asked = await otea(
        'say',
        'What do I do with it?',
        '--option',
        'Note it',
        '--option',
        'Leave it as an idea',
        '--recommend',
        '1',
        '--as',
        'sol',
      );

      expect(asked.code).toBe(0);
      expect(conversation().at(-1)).toMatchObject({
        options: ['Note it', 'Leave it as an idea'],
        recommended: 1,
      });
      const one = await otea('say', 'x?', '--option', 'only one', '--as', 'sol');
      expect(one.code).not.toBe(0);
      expect(one.err).toContain('2 to 4');
    });

    it('a card that sends an item back needs its note and an item in the person’s review: nothing is said otherwise', async () => {
      const half = await otea('say', 'Back?', '--send-back', 'CAM-1', '--as', 'sol');
      expect(half.code).toBe(2);
      expect(half.err).toContain('--send-back <id> and --note');

      const none = await otea(
        'say',
        'Send it back?',
        '--send-back',
        'CAM-1',
        '--note',
        'less green',
        '--option',
        'Send it back',
        '--option',
        'No',
        '--as',
        'sol',
      );
      expect(none.code).not.toBe(0);
      expect(conversation()).toEqual([]);
    });

    it('an item comes from a message or from a Bandeja note, not both', async () => {
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
        '--from-bandeja',
        'B-1',
        '--as',
        'sol',
      );

      expect(code).not.toBe(0);
      expect(err).toContain('a message or an Inbox note, not both');
      expect(JSON.parse((await otea('list', '--as', 'sol', '--json')).out)).toEqual([]);
    });

    it('--from-message of a message that is no turn of the person’s is refused before the item is made', async () => {
      const hi = person('hi');
      await otea('conversation', '--as', 'sol');
      // Answered first: a say with no --reply-to joins the message that waits for an answer, so a
      // notice of its own is one said when nothing waits.
      await otea('say', 'Hello.', '--reply-to', String(hi.id), '--as', 'sol');
      await otea('say', 'A notice.', '--as', 'sol');
      const notice = conversation().at(-1)?.id;

      const { code, err } = await otea(
        'create',
        '--collection',
        'tasks',
        '--title',
        'Orphan',
        '--description',
        'D',
        '--from-message',
        String(notice),
        '--as',
        'sol',
      );

      expect(code).not.toBe(0);
      expect(err).toContain('notice');
      expect(JSON.parse((await otea('list', '--as', 'sol', '--json')).out)).toEqual([]);
    });

    it('--from-message is the assistant’s alone, and refused before the item is made', async () => {
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
      expect(err).toContain('Only the assistant links the conversation to items');
      const list = JSON.parse((await otea('list', '--as', 'worker', '--json')).out);
      expect(list).toEqual([]);
    });
  });

  describe('as MCP tools', () => {
    it('serves conversation and say, which say as the assistant only', async () => {
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

        expect(conversation().map(({ author }) => author)).toEqual(['person', 'assistant']);
      } finally {
        await client.close();
      }
    });
  });
});
