import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES } from '../core/evidence.ts';
import { addCollection } from './collections.ts';
import {
  attachmentPaths,
  attachmentToServe,
  correctKind,
  fromMessageLine,
  linkMessageToItem,
  listConsultations,
  listConversation,
  postPersonMessage,
  readAsSecretary,
  sayAsSecretary,
  turnsOfItem,
} from './conversation.ts';
import { createItem } from './items.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryWake, startSecretaryWait } from './secretary.ts';
import { memoryContext, projectOf } from './testing.ts';
import { addTopic, answerTopic } from './topics.ts';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const clock = (offsetMs: number) => () => new Date(T0 + offsetMs).toISOString();

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('the conversation', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-conversation-'));
    project = projectOf(root, memoryContext());
    addCollection(project, { name: 'tasks' });
    declareSecretary(project.db, 'sol', clock(0));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const post = (
    text: string,
    at = 1000,
    extra: Partial<Parameters<typeof postPersonMessage>[1]> = {},
  ) => postPersonMessage(project, { text, ...extra }, clock(at)).message;

  const item = (title: string) =>
    createItem(project, {
      collection: 'tasks',
      title,
      fields: { description: 'Now' },
      actor: { kind: 'agent', name: 'sol' },
    }).id;

  describe('from the person to the secretary', () => {
    it('is pending, wakes the secretary from its own state, and stops waking once read', () => {
      const sent = post('the Aprobar button is hidden on the phone');
      expect(sent).toMatchObject({ author: 'person', delivery: 'pending', readAt: null });

      const wait = startSecretaryWait(clock(2000));
      const woke = secretaryWake(project, wait, clock(2000));
      expect(woke).toMatchObject({ kind: 'person_message', ref: String(sent.id) });
      expect(woke?.text).toContain('Aprobar button is hidden');
      // Not taken like a signal: every look finds it until it is read.
      expect(secretaryWake(project, startSecretaryWait(clock(3000)), clock(3000))?.ref).toBe(
        String(sent.id),
      );

      const read = readAsSecretary(project, { agent: 'sol' }, clock(4000));
      expect(read.fresh).toEqual([sent.id]);
      expect(read.messages.map(({ id, delivery }) => [id, delivery])).toEqual([[sent.id, 'read']]);
      expect(secretaryWake(project, startSecretaryWait(clock(5000)), clock(5000))).toBeUndefined();

      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'On it.', replyTo: sent.id },
        clock(6000),
      );
      expect(said.message).toMatchObject({
        author: 'secretary',
        by: 'sol',
        replyTo: sent.id,
        delivery: null,
      });
      expect(listConversation(project).messages.map(({ id, delivery }) => [id, delivery])).toEqual([
        [sent.id, 'read'],
        [said.message.id, null],
      ]);
    });

    it('names how many more wait, and a look that stops short leaves the rest pending', () => {
      for (let n = 1; n <= 3; n += 1) post(`message ${n}`, n * 1000);

      const first = readAsSecretary(project, { agent: 'sol', limit: 2 }, clock(9000));
      expect(first.fresh).toEqual([1, 2]);
      expect(first.more).toBe(true);
      expect(secretaryWake(project, startSecretaryWait(clock(9500)), clock(9500))?.ref).toBe('3');
      expect(listConversation(project, {}, clock(9500)).waiting).toMatchObject({ count: 1 });

      const second = readAsSecretary(project, { agent: 'sol', limit: 2 }, clock(10000));
      expect(second.fresh).toEqual([3]);
      // The talk before the first unread message comes along, so the answer has its context.
      expect(second.messages.map(({ id }) => id)).toEqual([1, 2, 3]);
      expect(
        secretaryWake(project, startSecretaryWait(clock(11000)), clock(11000)),
      ).toBeUndefined();
    });

    it('keeps a message sent again (a phone that never heard back) once', () => {
      const first = postPersonMessage(project, { text: 'hello', clientKey: 'k-1' }, clock(1000));
      const again = postPersonMessage(project, { text: 'hello', clientKey: 'k-1' }, clock(2000));

      expect(first.replayed).toBe(false);
      expect(again).toMatchObject({ replayed: true, message: { id: first.message.id } });
      expect(listConversation(project).messages).toHaveLength(1);
    });

    it('refuses an empty message, one too long, and a reply to nothing', () => {
      expect(() => post('   ')).toThrow(/some text or a file/);
      expect(() => post('x'.repeat(20_001))).toThrow(/at most 20000 characters/);
      expect(() => post('hi', 1000, { replyTo: 99 })).toThrow(/Message 99 not found/);
    });
  });

  describe('attachments', () => {
    it('keep an image with the message, served from the stored file, and a path for the agent', () => {
      const sent = post('see this', 1000, { files: [{ filename: 'phone.png', bytes: PNG }] });

      expect(sent.attachments).toEqual([
        expect.objectContaining({
          name: 'phone.png',
          kind: 'image',
          contentType: 'image/png',
          size: PNG.length,
        }),
      ]);
      const [file] = sent.attachments;
      const { path } = attachmentToServe(project, String(file?.id));
      expect(readFileSync(path).equals(PNG)).toBe(true);

      readAsSecretary(project, { agent: 'sol' }, clock(2000));
      const read = listConversation(project).messages[0];
      const paths = attachmentPaths(project, read as NonNullable<typeof read>);
      expect(readFileSync(paths.get(file?.id ?? 0) ?? '').equals(PNG)).toBe(true);
    });

    it('may come alone, and the same file twice is stored once', () => {
      const one = post('', 1000, { files: [{ filename: 'a.txt', bytes: Buffer.from('same') }] });
      const two = post('', 2000, { files: [{ filename: 'b.txt', bytes: Buffer.from('same') }] });

      expect(one.attachments[0]?.sha256).toBe(two.attachments[0]?.sha256);
      expect(attachmentToServe(project, String(one.attachments[0]?.id)).path).toBe(
        attachmentToServe(project, String(two.attachments[0]?.id)).path,
      );
    });

    it('go with the secretary’s message too, within the evidence limit', () => {
      const said = sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'the plan',
          files: [{ filename: 'plan.txt', bytes: Buffer.from('1. do it') }],
        },
        clock(1000),
      );
      expect(said.message.attachments).toEqual([
        expect.objectContaining({ name: 'plan.txt', kind: 'log' }),
      ]);

      expect(() =>
        post('big', 2000, {
          files: [{ filename: 'big.bin', bytes: Buffer.alloc(MAX_EVIDENCE_BYTES + 1) }],
        }),
      ).toThrow(/over the 50 MB evidence limit/);
      expect(() =>
        post('x', 3000, {
          files: Array.from({ length: 11 }, () => ({ filename: 'a', bytes: PNG })),
        }),
      ).toThrow(/at most 10 files/);
      expect(listConversation(project).messages).toHaveLength(1);
    });

    it('never take a path out of the file’s name', () => {
      const sent = post('x', 1000, {
        files: [{ filename: '..\\..\\evil.txt', bytes: Buffer.from('a') }],
      });

      expect(sent.attachments[0]?.name).toBe('evil.txt');
    });
  });

  describe('who may say', () => {
    it('only the project’s secretary: another agent is forbidden, and so is anyone while it has none', () => {
      const sent = post('hello');

      expect(() =>
        sayAsSecretary(project, { agent: 'luna', text: 'hi', replyTo: sent.id }, clock(2000)),
      ).toThrow(/luna is not this project's secretary \(sol is\)/);
      expect(() => readAsSecretary(project, { agent: 'luna' }, clock(2000))).toThrow(
        /Only the secretary reads/,
      );
      // What it could not read stays pending for the secretary.
      expect(listConversation(project).waiting.count).toBe(1);
      expect(listConversation(project).messages).toHaveLength(1);
    });

    it('is refused while the project has no secretary', () => {
      project.db.prepare("UPDATE agents SET role = NULL WHERE name = 'sol'").run();

      expect(() => sayAsSecretary(project, { agent: 'sol', text: 'hi' })).toThrow(/has none yet/);
    });
  });

  describe('requests', () => {
    it('link the items they produced both ways', () => {
      const sent = post('the Aprobar button is hidden on the phone');
      const fix = item('Show the Aprobar button on the phone');
      const test = item('Test it on a phone');

      const said = sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: `Made ${fix} and ${test}.`,
          replyTo: sent.id,
          kind: 'request',
          links: [fix, test],
        },
        clock(2000),
      );

      expect(said).toMatchObject({ kind: 'request', kept: false });
      expect(said.message.links).toEqual([fix, test]);
      // The person's message shows it too: the turn is one.
      const turn = listConversation(project).messages;
      expect(turn.map(({ id, kind, links, root }) => [id, kind, links, root])).toEqual([
        [sent.id, 'request', [fix, test], sent.id],
        [said.message.id, 'request', [fix, test], sent.id],
      ]);
      expect(turnsOfItem(project, fix)).toEqual([
        expect.objectContaining({
          id: sent.id,
          kind: 'request',
          snippet: 'the Aprobar button is hidden on the phone',
        }),
      ]);
      expect(fromMessageLine(turnsOfItem(project, test))).toContain(`message ${sent.id} (request)`);
      expect(turnsOfItem(project, item('Unrelated'))).toEqual([]);
    });

    it('take the person’s latest message when it says no reply-to, and refuse a link to no item', () => {
      const sent = post('add dark mode');
      const dark = item('Dark mode');

      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Filed.', links: [dark] },
        clock(2000),
      );
      expect(said.message).toMatchObject({ replyTo: sent.id, kind: 'request', links: [dark] });

      expect(() =>
        sayAsSecretary(
          project,
          { agent: 'sol', text: 'x', replyTo: sent.id, links: ['TASKS-99'] },
          clock(3000),
        ),
      ).toThrow(/TASKS-99/);
      expect(listConversation(project).messages).toHaveLength(2);
    });

    it('link an item made from a message (create --from-message), and make the turn a request', () => {
      const sent = post('please add dark mode');
      const dark = item('Dark mode');

      const linked = linkMessageToItem(project, 'sol', sent.id, dark, clock(2000));

      expect(linked).toMatchObject({ kind: 'request', links: [dark] });
      expect(() => linkMessageToItem(project, 'luna', sent.id, dark, clock(3000))).toThrow(
        /Only the secretary/,
      );
    });

    it('say nothing of a kind when it is plain talk', () => {
      const sent = post('thanks');

      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'You are welcome.', replyTo: sent.id },
        clock(2000),
      );

      expect(said).toMatchObject({ kind: null });
      expect(said.message.links).toEqual([]);
    });
  });

  describe('consultations', () => {
    it('keep the question and the answer, searchable, apart from the requests', () => {
      const q = post('why is the lease 15 minutes?', 1000);
      const a = sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'It covers a long build; see TASKS-1.',
          replyTo: q.id,
          kind: 'consultation',
        },
        clock(2000),
      );
      const other = post('add dark mode', 3000);
      sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'Filed.',
          replyTo: other.id,
          kind: 'request',
          links: [item('Dark mode')],
        },
        clock(4000),
      );

      expect(a.kind).toBe('consultation');
      const kept = listConsultations(project);
      expect(kept.messages.map(({ id }) => id)).toEqual([q.id, a.message.id]);
      expect(listConsultations(project, 'LEASE').messages.map(({ id }) => id)).toEqual([
        q.id,
        a.message.id,
      ]);
      expect(listConsultations(project, 'dark').messages).toEqual([]);
      // A search over everything finds the turn whichever of its messages holds the words.
      expect(
        listConversation(project, { search: 'long build' }).messages.map(({ id }) => id),
      ).toEqual([q.id, a.message.id]);
    });

    it('are what a new topic is: the question and the answer of otea topic', () => {
      const agent = { kind: 'agent' as const, name: 'kiln' };
      const topic = addTopic(
        project,
        { question: 'Which license do we use?', actor: agent },
        clock(1000),
      );
      answerTopic(
        project,
        { id: topic.id, summary: 'MIT.', full: 'MIT, for its simplicity.', actor: agent },
        clock(2000),
      );

      const kept = listConsultations(project).messages;
      expect(kept.map(({ author, by, text, topic: of }) => [author, by, text, of])).toEqual([
        ['agent', 'kiln', 'Which license do we use?', topic.id],
        ['agent', 'kiln', 'MIT, for its simplicity.', topic.id],
      ]);
      expect(kept[1]?.replyTo).toBe(kept[0]?.id);
      // A topic is a record, not a message waiting for the secretary.
      expect(listConversation(project).waiting.count).toBe(0);
      expect(secretaryWake(project, startSecretaryWait(clock(3000)), clock(3000))).toBeUndefined();

      // The answer given again replaces the text kept, not a second message.
      answerTopic(
        project,
        { id: topic.id, summary: 'MIT.', full: 'MIT, final.', actor: agent },
        clock(4000),
      );
      expect(listConsultations(project).messages.map(({ text }) => text)).toEqual([
        'Which license do we use?',
        'MIT, final.',
      ]);
    });
  });

  describe('the person’s correction', () => {
    it('changes the kind of the whole turn, and the secretary’s later say does not undo it', () => {
      const sent = post('what do you think of dark mode?');
      sayAsSecretary(
        project,
        {
          agent: 'sol',
          text: 'Filed it.',
          replyTo: sent.id,
          kind: 'request',
          links: [item('Dark mode')],
        },
        clock(2000),
      );

      const corrected = correctKind(project, sent.id, 'consultation');
      expect(corrected).toMatchObject({ kind: 'consultation', kindBy: 'person' });
      expect(listConversation(project).messages.map(({ kind }) => kind)).toEqual([
        'consultation',
        'consultation',
      ]);

      const again = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Still a request to me.', replyTo: sent.id, kind: 'request' },
        clock(3000),
      );
      expect(again).toMatchObject({ kind: 'consultation', kept: true });
      // The links stay: the turn is still traceable to what it produced.
      expect(again.message.links).toHaveLength(1);
    });

    it('works from either message of the turn, and refuses a message that is not there', () => {
      const sent = post('a question');
      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'an answer', replyTo: sent.id },
        clock(2000),
      );

      correctKind(project, said.message.id, 'request');

      expect(listConversation(project).messages.map(({ kind, kindBy }) => [kind, kindBy])).toEqual([
        ['request', 'person'],
        ['request', 'person'],
      ]);
      expect(() => correctKind(project, 99, 'request')).toThrow(/Message 99 not found/);
    });
  });

  describe('order and paging', () => {
    beforeEach(() => {
      for (let n = 1; n <= 7; n += 1) {
        if (n % 3 === 0) sayAsSecretary(project, { agent: 'sol', text: `m${n}` }, clock(n * 1000));
        else post(`m${n}`, n * 1000);
      }
    });

    const ids = (look: Parameters<typeof listConversation>[1]) =>
      listConversation(project, look).messages.map(({ id }) => id);

    it('gives the newest page first, in order, and says when more lie before it', () => {
      expect(ids({ limit: 3 })).toEqual([5, 6, 7]);
      expect(listConversation(project, { limit: 3 }).more).toBe(true);
      expect(listConversation(project, { limit: 7 }).more).toBe(false);
    });

    it('pages back with before, and forward with since', () => {
      expect(ids({ limit: 3, before: 5 })).toEqual([2, 3, 4]);
      expect(ids({ limit: 3, before: 2 })).toEqual([1]);
      expect(ids({ since: 4 })).toEqual([5, 6, 7]);
      expect(ids({ since: 4, limit: 2 })).toEqual([5, 6]);
      expect(listConversation(project, { since: 4, limit: 2 }).more).toBe(true);
      expect(ids({ since: 7 })).toEqual([]);
    });

    it('refuses a bad page', () => {
      expect(() => listConversation(project, { limit: 0 })).toThrow(/limit/);
      expect(() => listConversation(project, { since: 1, before: 5 })).toThrow(/not both/);
    });
  });
});
