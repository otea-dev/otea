import { describe, expect, it } from 'vitest';
import {
  asksOf,
  awayOf,
  branchOf,
  cardCounts,
  cardsOf,
  chipOf,
  FOLD_CHARS,
  FOLD_LINES,
  type Message,
  mergeMessages,
  otherKind,
  piecesOf,
  type SecretaryStatus,
  splitReply,
  thinkingRoot,
  turnAt,
  turnsOf,
} from './conversation.ts';
import { ago, item, NOW } from './derive/fixtures.ts';
import type { Item } from './types.ts';

let seq = 0;
function say(o: Partial<Message> & { author: Message['author'] }): Message {
  seq += 1;
  const id = o.id ?? seq;
  return {
    id,
    by: o.author === 'person' ? 'you' : 'quill',
    text: 'hello',
    at: ago(60),
    replyTo: null,
    root: id,
    kind: null,
    kindBy: null,
    links: [],
    attachments: [],
    delivery: o.author === 'person' ? 'read' : null,
    readAt: null,
    topic: null,
    ...o,
  };
}

const listening: SecretaryStatus = { name: 'quill', state: 'listening', since: null, pending: 0 };
const offline: SecretaryStatus = {
  name: 'quill',
  state: 'offline',
  since: ago(300),
  pending: 2,
};

const byId = (...items: Item[]) => new Map(items.map((each) => [each.id, each]));

describe('the conversation worked into turns', () => {
  it('groups a person message and the replies that answer it into one turn, in order', () => {
    const ask = say({ id: 1, author: 'person' });
    const answer = say({
      id: 2,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      kind: 'request',
      links: ['CAM-1'],
    });
    const next = say({ id: 3, author: 'person' });
    const turns = turnsOf([next, answer, ask]);
    // Messages come in any order; the turns come in the order they began.
    expect(turns.map((turn) => turn.root)).toEqual([1, 3]);
    expect(turns[0]?.person.map((m) => m.id)).toEqual([1]);
    expect(turns[0]?.replies.map((m) => m.id)).toEqual([2]);
    expect(turns[0]).toMatchObject({ kind: 'request', links: ['CAM-1'], waits: null });
  });

  it('keeps the newest copy of a message when pages overlap', () => {
    const read = say({ id: 5, author: 'person', delivery: 'read' });
    const stale = { ...read, delivery: 'pending' as const };
    expect(mergeMessages([stale], [read]).map((m) => m.delivery)).toEqual(['read']);
    expect(mergeMessages([say({ id: 9, author: 'person' })], [read]).map((m) => m.id)).toEqual([
      5, 9,
    ]);
  });
});

describe('the secretary thinking', () => {
  it('holds the turn it read and has not answered, only while it is there', () => {
    const turns = turnsOf([
      say({ id: 1, author: 'person', delivery: 'read' }),
      say({ id: 2, author: 'secretary', replyTo: 1, root: 1 }),
      say({ id: 3, author: 'person', delivery: 'read' }),
    ]);
    expect(thinkingRoot(turns, listening)).toBe(3);
    // Offline nothing is thinking: the banner says it is away.
    expect(thinkingRoot(turns, offline)).toBeUndefined();
    expect(thinkingRoot(turns, null)).toBeUndefined();
  });

  it('is not thinking about a message it has not read, nor one it answered', () => {
    const pending = turnsOf([say({ id: 1, author: 'person', delivery: 'pending' })]);
    expect(pending[0]?.waits).toBe('pending');
    expect(thinkingRoot(pending, listening)).toBeUndefined();
    const answered = turnsOf([
      say({ id: 1, author: 'person', delivery: 'read' }),
      say({ id: 2, author: 'secretary', replyTo: 1, root: 1 }),
    ]);
    expect(thinkingRoot(answered, listening)).toBeUndefined();
  });

  it('says since when it is away, and nothing while it is there', () => {
    expect(awayOf(offline)).toEqual({ since: offline.since });
    expect(awayOf(listening)).toBeNull();
    expect(awayOf(null)).toBeNull();
  });
});

describe('a reply folding', () => {
  it('leads with its first line and keeps a short rest open', () => {
    expect(splitReply('Done.\nOne more thing.')).toEqual({
      lead: 'Done.',
      rest: 'One more thing.',
      folds: false,
    });
    expect(splitReply('Only a line').rest).toBe('');
  });

  it('folds a rest that is long in lines or in characters', () => {
    const lines = splitReply(['Lead', 'a', 'b', 'c', 'd', 'e'].join('\n'));
    expect(lines.folds).toBe(true);
    const chars = splitReply(`Lead\n${'x'.repeat(FOLD_CHARS + 1)}`);
    expect(chars.folds).toBe(true);
    expect(splitReply(`Lead\n${'x'.repeat(FOLD_CHARS)}`).folds).toBe(false);
  });

  // The secretary's rule (M4, its role text): the conclusion, then at most 3 short lines. The page
  // shows exactly that much and folds the first line over it.
  it('keeps what the secretary rule allows, a line and 3 short ones, and folds a fourth', () => {
    const short = 'x'.repeat(70);
    expect(FOLD_LINES).toBe(3);
    expect(splitReply(['Lead', short, short, short].join('\n')).folds).toBe(false);
    expect(splitReply(['Lead', short, short, short, short].join('\n')).folds).toBe(true);
  });

  it('does not count the blank lines between paragraphs as lines', () => {
    expect(splitReply('Lead\n\nOne.\n\nTwo.\n\nThree.').folds).toBe(false);
    expect(splitReply('Lead\n\nOne.\n\nTwo.\n\nThree.\n\nFour.').folds).toBe(true);
  });
});

describe('plain words with ids and links', () => {
  it('links the ids of this project and web addresses, and leaves the rest as it was', () => {
    const pieces = piecesOf('See CAM-12 and ZZ-9 at https://otea.dev/x.', new Set(['CAM-12']));
    expect(pieces).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'item', id: 'CAM-12' },
      { kind: 'text', text: ' and ZZ-9 at ' },
      { kind: 'url', url: 'https://otea.dev/x' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a sentence’s punctuation and a closing parenthesis out of an address', () => {
    for (const end of ['.', ',', ';', ':', '!', '?', '.)', '?!']) {
      const [, url, rest] = piecesOf(`(ver https://otea.dev/a?b=1${end}`, new Set());
      expect(url).toEqual({ kind: 'url', url: 'https://otea.dev/a?b=1' });
      expect(rest).toEqual({ kind: 'text', text: end });
    }
    // An address that ends in a word keeps all of it.
    expect(piecesOf('https://otea.dev/a-b_c/', new Set())).toEqual([
      { kind: 'url', url: 'https://otea.dev/a-b_c/' },
    ]);
  });
});

describe('what a request produced', () => {
  const working = item({
    id: 'CAM-12',
    title: 'La barra fija tapa Aprobar',
    turn: 'agent',
    lease: { holder: 'worker', expiresAt: new Date(NOW + 600_000).toISOString() },
  });
  const queued = item({ id: 'CAM-13', title: 'Test visual', turn: 'agent' });
  const asking = item({
    id: 'CAM-14',
    title: 'Tablet',
    turn: 'human',
    asks: { question: 1, by: 'worker', text: '¿Tablet?', at: ago(3), options: ['Sí', 'No'] },
  });
  const done = item({ id: 'CAM-15', title: 'Listo', turn: 'none', closes: 'done' });

  it('shows each item with the look its node has now and the word of its state', () => {
    const items = byId(working, queued, asking, done);
    expect(chipOf('CAM-12', items, NOW)).toMatchObject({
      look: 'working',
      state: 'hablar.st.working',
      agent: 'worker',
    });
    expect(chipOf('CAM-13', items, NOW)).toMatchObject({
      look: 'queued',
      state: 'hablar.st.queued',
    });
    expect(chipOf('CAM-14', items, NOW)).toMatchObject({
      look: 'yours',
      state: 'hablar.st.asks',
      asks: true,
    });
    expect(chipOf('CAM-15', items, NOW)).toMatchObject({ look: 'done', state: 'hablar.st.done' });
    // A board draft has no item behind it yet.
    expect(chipOf('DOC', items, NOW)).toMatchObject({ look: null, state: 'hablar.st.draft' });
  });

  it('lists the chips in the order the secretary linked them, and the questions that wait', () => {
    const items = byId(working, queued, asking);
    const [turn] = turnsOf([
      say({ id: 1, author: 'person' }),
      say({
        id: 2,
        author: 'secretary',
        replyTo: 1,
        root: 1,
        kind: 'request',
        links: ['CAM-13', 'CAM-12', 'CAM-14'],
      }),
    ]);
    if (!turn) throw new Error('no turn');
    expect(branchOf(turn, items, NOW).map((chip) => chip.id)).toEqual([
      'CAM-13',
      'CAM-12',
      'CAM-14',
    ]);
    expect(asksOf(turn, items).map((each) => each.id)).toEqual(['CAM-14']);
  });
});

describe('what came out, in cards', () => {
  const items = byId(
    item({ id: 'CAM-12', turn: 'human', asks: { question: 1, by: 'w', text: '?', at: ago(1) } }),
    item({ id: 'CAM-13', turn: 'agent' }),
  );
  const turns = turnsOf([
    say({ id: 1, author: 'person', text: 'El botón queda tapado' }),
    say({
      id: 2,
      author: 'secretary',
      replyTo: 1,
      root: 1,
      kind: 'request',
      links: ['CAM-12', 'CAM-13'],
    }),
    say({ id: 3, author: 'person', text: '¿Un tablero por cliente?' }),
    say({
      id: 4,
      author: 'secretary',
      replyTo: 3,
      root: 3,
      kind: 'consultation',
      text: 'Sí, si cada cliente revisa distinto.\nMás detalle.',
    }),
    // A request with nothing linked yet is still being worked out; ordinary talk has no card.
    say({ id: 5, author: 'person', text: 'Armá algo' }),
    say({ id: 6, author: 'secretary', replyTo: 5, root: 5, kind: 'request' }),
    say({ id: 7, author: 'person', text: 'Gracias' }),
  ]);

  it('makes a card per request with its items, and per consultation with its answer, newest first', () => {
    const cards = cardsOf(turns, items, NOW);
    expect(cards.map((card) => [card.root, card.kind])).toEqual([
      [3, 'consultation'],
      [1, 'request'],
    ]);
    expect(cards[1]).toMatchObject({ title: 'El botón queda tapado', asks: true });
    expect(cards[1]?.chips.map((chip) => chip.id)).toEqual(['CAM-12', 'CAM-13']);
    expect(cards[0]).toMatchObject({ answer: 'Sí, si cada cliente revisa distinto.' });
  });

  it('filters by kind and counts each', () => {
    expect(cardsOf(turns, items, NOW, 'request').map((card) => card.root)).toEqual([1]);
    expect(cardsOf(turns, items, NOW, 'consultation').map((card) => card.root)).toEqual([3]);
    expect(cardCounts(turns, items, NOW)).toEqual({ all: 2, request: 1, consultation: 1 });
  });
});

describe('finding a turn', () => {
  const turns = turnsOf([
    say({ id: 10, author: 'person' }),
    say({ id: 11, author: 'secretary', replyTo: 10, root: 10 }),
    say({ id: 20, author: 'person' }),
    say({ id: 21, author: 'agent', replyTo: 20, root: 20, topic: 'TEM-3' }),
  ]);

  it('finds a turn by the number of any of its messages, or by the topic it records', () => {
    expect(turnAt(turns, { turn: 11 })?.root).toBe(10);
    expect(turnAt(turns, { turn: 20 })?.root).toBe(20);
    expect(turnAt(turns, { topic: 'TEM-3' })?.root).toBe(20);
    expect(turnAt(turns, { turn: 99 })).toBeUndefined();
  });

  it('turns a request into a consultation and back', () => {
    expect(otherKind('request')).toBe('consultation');
    expect(otherKind('consultation')).toBe('request');
  });
});
