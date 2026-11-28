import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bandejaRef } from '../core/bandeja.ts';
import { sequenceIds } from '../core/board/ids.ts';
import { creatures } from '../core/board/testing.ts';
import { signalsOf } from '../core/notify/signals.ts';
import { counted, OFF_ITEM, pendingCounts } from '../core/pending.ts';
import { countedOff, waitsForPerson } from '../core/waiting.ts';
import { countsOf } from '../server/projects.ts';
import { askOnBandeja, captureToBandeja, takeBandeja } from './bandeja.ts';
import { createBoard, publishBoard, saveDraft } from './boards.ts';
import { addCollection } from './collections.ts';
import { listConversation, postPersonMessage, sayAsSecretary } from './conversation.ts';
import { escalateToSecretary } from './escalate.ts';
import { createItem, listItems } from './items.ts';
import { claimItem } from './leases.ts';
import { pendingLine, pendingOf, pendingText } from './pending.ts';
import { CLI_HARNESS, endProcess, seeAgent, waitBeat } from './presence.ts';
import type { Project } from './project.ts';
import { declareSecretary, secretaryStatus } from './secretary.ts';
import { secretaryView } from './secretary-waiting.ts';
import { memoryContext, projectOf, REVIEWS } from './testing.ts';

// The owner's rule: what Otea shows must be true, and one inconsistency (a «no agents» while two
// show) costs the trust of the whole product. These are the invariants of the server's side: every
// place that says how many things wait for the person, or where the secretary stands, says what the
// one source says, for the same state of the project (docs/internal/shown-facts.md).

const MIN = 60_000;
const you = { kind: 'human' as const, name: 'fede' };
const agent = (name: string) => ({ kind: 'agent' as const, name });
// The state of a project is made in the recent past, as the server reads it with the real clock.
const ago = (minutes: number) => () => new Date(Date.now() - minutes * MIN).toISOString();
const now = () => new Date().toISOString();

describe('what waits for the person, from every place that counts it', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-facts-'));
    project = projectOf(root, memoryContext(REVIEWS));
    addCollection(project, { name: 'reviews', preset: 'reviews' });
    declareSecretary(project.db, 'sol', ago(300));
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  // Everything that can wait: a review and a step, the secretary's question about that review and
  // an unrelated one, a refiner's question on a note, what an agent escalated while the secretary is
  // away, an agent gone quiet on an item, a lapse of an agent that is still there, and a board
  // nobody works.
  function crowded() {
    const review = createItem(
      project,
      { collection: 'reviews', title: 'CSS review', actor: agent('kiln') },
      ago(50),
    ).id;
    createItem(project, { collection: 'reviews', title: 'Call the bank', actor: you }, ago(49));
    sayAsSecretary(
      project,
      {
        agent: 'sol',
        text: 'Send CSS review back?',
        links: [review],
        options: ['Send back', 'No'],
      },
      ago(40),
    );
    sayAsSecretary(project, { agent: 'sol', text: 'Which day?', options: ['Mon', 'Tue'] }, ago(39));
    const noteId = captureToBandeja(project, { text: 'dark mode somewhere' }, ago(38)).entry.id;
    takeBandeja(project, { id: noteId, agent: 'lia' }, ago(37));
    askOnBandeja(
      project,
      { id: noteId, agent: 'lia', text: 'Which screen?', options: ['Te toca', 'Hablar'] },
      ago(36),
    );
    escalateToSecretary(
      project,
      { agent: 'kiln', about: review, text: 'the build is red' },
      ago(30),
    );

    const def = creatures();
    const board = createBoard(project, { name: def.name, lang: 'es' }, ago(200), sequenceIds());
    saveDraft(project, board.id, { definition: def, baseVersion: null }, ago(200));
    publishBoard(project, board.id, { moves: {}, by: you }, ago(200));
    const make = (title: string, at: number) =>
      createItem(
        project,
        { collection: 'Criaturas', title, fields: { fdesc: 'Lenta' }, actor: you },
        ago(at),
      ).id;
    const quiet = make('Tortuga', 150);
    const lapsed = make('Rana', 149);
    make('Lombriz', 20);
    // «mender» stays at work (a process of this test); «kiln» is gone: its lease ran out.
    claimItem(project, { id: lapsed, actor: agent('mender'), ttlMs: 1 }, ago(100));
    claimItem(project, { id: quiet, actor: agent('kiln'), ttlMs: 1 }, ago(60));
    waitBeat(project.db, { agent: 'mender', channel: 'cli', waiter: process.pid }, now).run();
    return { review, quiet, lapsed };
  }

  it('is one number on every server surface, and the UI’s count of the same state', () => {
    const { quiet, lapsed } = crowded();
    const pending = pendingOf(project, now);
    const items = listItems(project, {}, now);

    // The fixture holds what it is meant to: the secretary's question about the review is listed,
    // and is not a second thing.
    expect(pending.entries.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['bandeja', 'secretary', 'escalation', 'stuck', 'review', 'step']),
    );
    expect(pending.entries.filter(({ about }) => about !== undefined)).toHaveLength(1);
    expect(counted(pending.entries)).toHaveLength(pending.entries.length - 1);
    // Gone quiet is stuck; a lapse of an agent that is still there is not.
    expect(pending.entries.find(({ kind }) => kind === 'stuck')?.ref).toBe(quiet);
    expect(pending.entries.some(({ ref }) => ref === lapsed)).toBe(false);

    const one = pending.count;
    expect(one).toBeGreaterThan(5);
    // `otea pending`: the count, the per-kind sum and the line at the foot of a wait.
    expect(Object.values(pendingCounts(pending.entries)).reduce((n, each) => n + each, 0)).toBe(
      one,
    );
    expect(pendingText(pending)).toContain(`${one} things wait for the person`);
    expect(pendingLine(pending)).toContain(`${one} things wait for the person`);
    // The projects overview (the switcher, «Todos los proyectos»): items and what is no item.
    const overview = countsOf(project);
    expect(overview.waiting.length + overview.asking.length).toBe(one);
    // The notifier: a notice for each item that waits (a turn, a question, a stuck one).
    const toldItems = signalsOf(items as never, Date.now()).filter(({ kind }) =>
      ['turn', 'ask', 'stuck'].includes(kind),
    );
    const itemEntries = pending.entries.filter(({ kind }) => !OFF_ITEM.includes(kind));
    expect(toldItems).toHaveLength(itemEntries.length);
    // The desk's number (ui/src/pending.ts waitingCount) is these two rules over the same items and
    // the same pending answer; the UI half of this is in ui/src/shown-facts.test.tsx.
    const theirs = items.filter((item) => waitsForPerson(item, Date.now()));
    const off = pending.entries.filter(({ kind }) => OFF_ITEM.includes(kind));
    expect(theirs.length + countedOff(off, new Set(theirs.map(({ id }) => id))).length).toBe(one);
  });

  it('counts a secretary’s question about an item once, with the item', () => {
    const review = createItem(
      project,
      { collection: 'reviews', title: 'CSS review', actor: agent('kiln') },
      ago(50),
    ).id;
    expect(pendingOf(project, now).count).toBe(1);
    sayAsSecretary(
      project,
      { agent: 'sol', text: 'Send it back?', links: [review], options: ['Send back', 'No'] },
      ago(40),
    );
    const pending = pendingOf(project, now);
    expect(pending.entries).toHaveLength(2);
    expect(pending.count).toBe(1);
    expect(pendingText(pending)).toContain('1 thing waits for the person');
    expect(countsOf(project).waiting).toHaveLength(1);
    expect(countsOf(project).asking).toHaveLength(0);
  });
});

describe('the secretary, from every place that says where it stands', () => {
  let root: string;
  let project: Project;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otea-facts-'));
    project = projectOf(root, memoryContext(REVIEWS));
    addCollection(project, { name: 'reviews', preset: 'reviews' });
  });

  afterEach(() => {
    project.db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const earlier = (minutes: number) => ago(minutes);
  const running = () => true;
  const gone = () => false;

  // Each of these is a way the secretary can stand. `listening`/`connected`: its process runs;
  // `ended`: its session is over (killed, with no goodbye); `silent`: not heard for a long time.
  const states: [string, () => void, 'listening' | 'connected' | 'offline'][] = [
    [
      'in its wait',
      () => {
        declareSecretary(project.db, 'sol', earlier(1), running);
        waitBeat(
          project.db,
          { agent: 'sol', channel: 'cli', waiter: process.pid },
          earlier(0),
        ).run();
      },
      'listening',
    ],
    [
      'heard, not waiting',
      () => {
        declareSecretary(project.db, 'sol', earlier(1), running);
        seeAgent(
          project.db,
          { agent: 'sol', channel: 'mcp', harness: { name: 'claude-code' }, session: process.pid },
          earlier(0),
        );
      },
      'connected',
    ],
    [
      'its session killed',
      () => {
        declareSecretary(project.db, 'sol', earlier(5), running);
        waitBeat(project.db, { agent: 'sol', channel: 'cli', waiter: 4242 }, earlier(4)).run();
        endProcess(project.db, 4242);
      },
      'offline',
    ],
    [
      'not heard for an hour',
      () => {
        declareSecretary(project.db, 'sol', earlier(60), running);
        seeAgent(project.db, { agent: 'sol', channel: 'cli', harness: CLI_HARNESS }, earlier(60));
      },
      'offline',
    ],
  ];

  for (const [name, arrange, expected] of states) {
    it(`says the same everywhere while it is ${name}, and a new session may take over only when it is offline`, () => {
      arrange();
      // A message the person wrote and nobody read, a report an agent escalated, and a note.
      postPersonMessage(project, { text: 'are you there?' }, earlier(2));
      const note = captureToBandeja(project, { text: 'a rough idea' }, earlier(2)).entry;
      escalateToSecretary(
        project,
        { agent: 'kiln', about: bandejaRef(note.id), text: 'build red' },
        earlier(2),
      );

      const view = secretaryView(project.db, now);
      const conversation = listConversation(project, {}, now);
      const pending = pendingOf(project, now);
      expect(view?.state).toBe(expected);
      for (const other of [
        conversation.secretary,
        pending.secretary,
        secretaryStatus(project.db, now),
      ]) {
        expect(other).toMatchObject({ name: 'sol', state: view?.state, since: view?.since });
      }
      // What waits for it is one object, counted once, by what each is.
      expect(conversation.waiting).toEqual(view?.waiting);
      expect(pending.secretary?.waiting).toEqual(view?.waiting);
      expect(view?.waiting).toMatchObject({ messages: 1 });
      expect(view?.waiting.count).toBe(
        (view?.waiting.messages ?? 0) + (view?.waiting.notes ?? 0) + (view?.waiting.reports ?? 0),
      );

      // s-real2 D-5645a2: the desk says «offline» exactly when another session may take the role.
      let taken = true;
      try {
        declareSecretary(project.db, 'luna', now, expected === 'offline' ? gone : running);
      } catch {
        taken = false;
      }
      expect(taken).toBe(expected === 'offline');
    });
  }

  // s-real2 D-fbe122: «2 messages are waiting» was one message and a report: the words are the
  // server's parts, never their sum called messages.
  it('counts an escalation or a note as what it is, never as a message', () => {
    declareSecretary(project.db, 'sol', ago(60), () => true);
    const note = captureToBandeja(project, { text: 'a rough idea' }, ago(20)).entry;
    escalateToSecretary(
      project,
      { agent: 'kiln', about: bandejaRef(note.id), text: 'build red' },
      ago(30),
    );

    expect(secretaryView(project.db, now)?.waiting).toMatchObject({
      messages: 0,
      reports: 1,
      notes: 1,
      count: 2,
    });
    expect(listConversation(project, {}, now).waiting.messages).toBe(0);
  });
});
