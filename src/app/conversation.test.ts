import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES } from '../core/evidence.ts';
import { addCollection } from './collections.ts';
import {
  attachmentPaths,
  attachmentToServe,
  conversationText,
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
    // F2 (field study 3): the secretary answers from the text the wake gave it, without running
    // `otea conversation`, and its next wait returned the same message again, several times.
    it('does not wake the secretary again for a message it answered, read or not', () => {
      const first = post('is Tailscale or the relay better?', 1000);
      const second = post('and the Aprobar button?', 1500);

      sayAsSecretary(project, { agent: 'sol', text: 'Tailscale.', replyTo: first.id }, clock(2000));

      const wake = secretaryWake(project, startSecretaryWait(clock(3000)), clock(3000));
      // Only the one it did not answer comes back.
      expect(wake).toMatchObject({ kind: 'person_message', ref: String(second.id) });

      const answer = { agent: 'sol', text: 'Visible now.', replyTo: second.id };
      sayAsSecretary(project, answer, clock(4000));
      expect(secretaryWake(project, startSecretaryWait(clock(5000)), clock(5000))).toBeUndefined();
    });

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
      const key = { scope: 'desk', key: 'k-1' };
      const first = postPersonMessage(project, { text: 'hello', clientKey: key }, clock(1000));
      const again = postPersonMessage(project, { text: 'hello', clientKey: key }, clock(2000));

      expect(first.replayed).toBe(false);
      expect(again).toMatchObject({ replayed: true, message: { id: first.message.id } });
      expect(listConversation(project).messages).toHaveLength(1);
    });

    it('refuses the same key with another message, and keeps each device’s keys apart', () => {
      const first = postPersonMessage(
        project,
        { text: 'hello', clientKey: { scope: 'device:a', key: 'k-1' } },
        clock(1000),
      );

      expect(() =>
        postPersonMessage(
          project,
          { text: 'something else', clientKey: { scope: 'device:a', key: 'k-1' } },
          clock(2000),
        ),
      ).toThrow(/already sent another message/);
      // Same words and key from another device: its own message, not the first one's.
      const other = postPersonMessage(
        project,
        { text: 'something else', clientKey: { scope: 'device:b', key: 'k-1' } },
        clock(3000),
      );
      expect(other).toMatchObject({ replayed: false });
      expect(other.message.id).not.toBe(first.message.id);
      expect(listConversation(project).messages).toHaveLength(2);
    });

    it('tells a resend from another message by its files too', () => {
      const key = { scope: 'desk', key: 'k-2' };
      const files = [{ filename: 'a.txt', bytes: Buffer.from('one') }];
      postPersonMessage(project, { text: 'x', files, clientKey: key }, clock(1000));

      expect(
        postPersonMessage(project, { text: 'x', files, clientKey: key }, clock(2000)).replayed,
      ).toBe(true);
      expect(() =>
        postPersonMessage(
          project,
          { text: 'x', files: [{ filename: 'a.txt', bytes: Buffer.from('two') }], clientKey: key },
          clock(3000),
        ),
      ).toThrow(/already sent another message/);
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

    it('are opened under a safe name when the one they came with is not (device names, a lone space, a very long name), the original kept to show', () => {
      const long = `${'long-'.repeat(60)}.png`;
      const names = ['CON.txt', 'nul', ' ', 'report. ', 'a*b?.txt', long];
      const sent = post('odd names', 1000, {
        files: names.map((filename) => ({ filename, bytes: Buffer.from(filename) })),
      });

      expect(sent.attachments.map(({ name }) => name)).toEqual([
        'CON.txt',
        'nul',
        'file',
        'report.',
        'a*b?.txt',
        `${long.slice(0, 200 - 4 - 1)}….png`,
      ]);
      const read = readAsSecretary(project, { agent: 'sol' }, clock(2000));
      expect(read.problems.size).toBe(0);
      const opened = sent.attachments.map(({ id }) => basename(read.paths.get(id) ?? ''));
      expect(opened.slice(0, 5)).toEqual(['_CON.txt', '_nul', 'file', 'report', 'a_b_.txt']);
      expect(opened[5]?.length).toBeLessThanOrEqual(120);
      expect(opened[5]?.endsWith('.png')).toBe(true);
      for (const [index, { id }] of sent.attachments.entries()) {
        expect(readFileSync(read.paths.get(id) ?? '', 'utf8')).toBe(names[index]);
      }
    });

    it('that cannot be opened at a path never cost the message: it is read, the file noted', () => {
      const sent = post('two files', 1000, {
        files: [
          { filename: 'gone.txt', bytes: Buffer.from('gone') },
          { filename: 'fine.txt', bytes: Buffer.from('fine') },
        ],
      });
      const [gone, fine] = sent.attachments;
      rmSync(attachmentToServe(project, String(gone?.id)).path);

      const read = readAsSecretary(project, { agent: 'sol' }, clock(2000));

      expect(read.fresh).toEqual([sent.id]);
      expect(listConversation(project).messages[0]?.delivery).toBe('read');
      expect(read.problems.get(gone?.id ?? 0)).toMatch(/missing/);
      expect(readFileSync(read.paths.get(fine?.id ?? 0) ?? '', 'utf8')).toBe('fine');
      const text = conversationText('sol', read);
      expect(text).toContain('attached: gone.txt (log, 4 B) (no path: the stored file is missing)');
      expect(text).toContain(`: ${read.paths.get(fine?.id ?? 0)}`);
      expect(text).toContain('1 file(s) could not be made available');
    });

    it('whose folder cannot be made are noted too, not thrown', () => {
      const sent = post('a file', 1000, {
        files: [{ filename: 'a.txt', bytes: Buffer.from('a') }],
      });
      // Where the files go is taken by a file: the disk refuses.
      writeFileSync(join(project.dataDir, 'files'), 'in the way');

      const read = readAsSecretary(project, { agent: 'sol' }, clock(2000));

      expect(read.fresh).toEqual([sent.id]);
      expect(read.problems.size).toBe(1);
      expect(read.paths.size).toBe(0);
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

    it('take the person’s latest read message when it says no reply-to, and refuse a link to no item', () => {
      const sent = post('add dark mode');
      readAsSecretary(project, { agent: 'sol' }, clock(1500));
      const dark = item('Dark mode');

      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Filed.', kind: 'request', links: [dark] },
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

    it('refuse to guess the turn while a later message of the person is not read yet', () => {
      const first = post('add dark mode', 1000);
      readAsSecretary(project, { agent: 'sol' }, clock(1500));
      post('and make the font bigger', 2000);
      const dark = item('Dark mode');

      expect(() =>
        sayAsSecretary(
          project,
          { agent: 'sol', text: 'Filed.', kind: 'request', links: [dark] },
          clock(3000),
        ),
      ).toThrow(/1 of the person's messages are not read yet.*--reply-to/);
      expect(() =>
        sayAsSecretary(project, { agent: 'sol', text: 'Q.', kind: 'consultation' }, clock(3000)),
      ).toThrow(/--reply-to/);
      // Naming the turn is never a guess.
      const said = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Filed.', links: [dark], replyTo: first.id },
        clock(3000),
      );
      expect(said.message).toMatchObject({ replyTo: first.id, kind: 'request' });
      expect(turnsOfItem(project, dark)).toEqual([expect.objectContaining({ id: first.id })]);
    });

    it('refuse to guess between several read turns not classified yet', () => {
      post('one', 1000);
      post('two', 2000);
      readAsSecretary(project, { agent: 'sol' }, clock(2500));

      expect(() =>
        sayAsSecretary(project, { agent: 'sol', text: 'x', kind: 'request' }, clock(3000)),
      ).toThrow(/2 read messages are not classified.*--reply-to/);

      sayAsSecretary(
        project,
        { agent: 'sol', text: 'x', kind: 'consultation', replyTo: 1 },
        clock(3100),
      );
      // One turn left unclassified: no doubt which.
      expect(
        sayAsSecretary(project, { agent: 'sol', text: 'y', kind: 'request' }, clock(3200)).message
          .replyTo,
      ).toBe(2);
    });

    it('never aim at a topic’s record when the person has said nothing else', () => {
      const agent = { kind: 'agent' as const, name: 'kiln' };
      addTopic(
        project,
        { question: 'Which license?', actor: { kind: 'human', name: 'human' } },
        clock(1000),
      );
      answerTopic(project, { id: 'TEM-1', summary: 'MIT.', actor: agent }, clock(2000));

      expect(() =>
        sayAsSecretary(project, { agent: 'sol', text: 'x', kind: 'request' }, clock(3000)),
      ).toThrow(/no message of the person to classify/);

      // And a real message of the person is the target, whatever the topics came after.
      const sent = post('add dark mode', 4000);
      addTopic(
        project,
        { question: 'And the font?', actor: { kind: 'human', name: 'human' } },
        clock(5000),
      );
      readAsSecretary(project, { agent: 'sol' }, clock(5500));
      expect(
        sayAsSecretary(project, { agent: 'sol', text: 'Filed.', kind: 'request' }, clock(6000))
          .message.replyTo,
      ).toBe(sent.id);
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

    // Field study 3 review: a search is all of its words, wherever they stand in the turn, and a
    // wildcard typed in it is only a character.
    it('searches for all the words, apart or in different messages, and takes % as a character', () => {
      const asked = postPersonMessage(
        project,
        { text: 'Should the dark theme use a mode switch?' },
        clock(5000),
      ).message;
      readAsSecretary(project, { agent: 'sol' }, clock(5100));
      const answer = sayAsSecretary(
        project,
        { agent: 'sol', text: 'Yes, one toggle.', replyTo: asked.id, kind: 'consultation' },
        clock(5200),
      ).message;
      const found = (search: string) =>
        listConversation(project, { search }).messages.map(({ id }) => id);
      expect(found('dark mode')).toEqual([asked.id, answer.id]);
      expect(found('mode dark')).toEqual([asked.id, answer.id]);
      // One word in the question, the other in the answer of the same turn.
      expect(found('dark toggle')).toEqual([asked.id, answer.id]);
      expect(found('dark zzzz')).toEqual([]);
      expect(found('100%')).toEqual([]);
    });

    // Cold review G2: SQLite's LIKE folds ASCII only, so «ñandú» never matched «Ñandú», and a
    // search of any length was run as typed.
    it('finds a word whatever the case of its accented letters, and reads only a bounded search', () => {
      const said = (text: string, at: number) =>
        postPersonMessage(project, { text }, clock(at)).message.id;
      const nandu = said('El Ñandú corre por el ÁRBOL', 6000);
      const found = (search: string) =>
        listConversation(project, { search }).messages.map(({ id }) => id);
      expect(found('ñandú')).toEqual([nandu]);
      expect(found('ÑANDÚ')).toEqual([nandu]);
      expect(found('árbol')).toEqual([nandu]);
      expect(found('Á')).toEqual([nandu]);
      expect(found('é')).toEqual([]);

      // Only the first 8 words count: a ninth that is nowhere is not read.
      expect(found('el el el el el el el el zzzz')).toEqual([nandu]);
      expect(found('el zzzz')).toEqual([]);
      // Only the first 200 characters count.
      expect(found(`ñandú${' '.repeat(250)}zzzz`)).toEqual([nandu]);
      expect(found(`ñandú${' '.repeat(100)}zzzz`)).toEqual([]);
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
