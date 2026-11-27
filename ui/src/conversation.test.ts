import { describe, expect, it } from 'vitest';
import {
  asksOf,
  awayOf,
  blocksOf,
  branchOf,
  cardCounts,
  cardsOf,
  chipOf,
  FOLD_CHARS,
  FOLD_LINES,
  fencesOf,
  type Message,
  mergeMessages,
  otherKind,
  piecesOf,
  rowsOf,
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
    options: [],
    recommended: null,
    action: null,
    unverified: false,
    optionText: [],
    closed: null,
    choice: null,
    heardAt: null,
    kindNews: false,
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

describe('the thread in time', () => {
  // The secretary's news arrive as messages of their own and stand where they were said, below
  // what the person wrote since; a reply to an older message says which one it answers.
  it('lists every message once, in the order it was said, whatever turn it belongs to', () => {
    const messages = [
      say({ id: 1, author: 'person', text: 'Armá el tablero' }),
      say({ id: 2, author: 'secretary', replyTo: 1, root: 1, text: 'Hecho.' }),
      say({ id: 3, author: 'person', text: '¿Y los reintentos?' }),
      say({ id: 4, author: 'secretary', replyTo: 3, root: 3, text: 'Mejor con backoff.' }),
      say({ id: 5, author: 'secretary', replyTo: 1, root: 1, text: 'CAM-1 está listo.' }),
      say({ id: 6, author: 'secretary', text: 'CAM-2 espera tu revisión.', links: ['CAM-2'] }),
    ];
    const rows = rowsOf(messages, turnsOf(messages));

    expect(rows.map((row) => row.message.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((row) => row.type)).toEqual([
      'person',
      'reply',
      'person',
      'reply',
      'reply',
      'reply',
    ]);
    // Only a reply that is not right after the message it answers names it.
    expect(rows.map((row) => (row.type === 'reply' ? (row.answers?.id ?? null) : null))).toEqual([
      null,
      null,
      null,
      null,
      1,
      null,
    ]);
    // The first reply of a turn carries its kind and its branch; a later one does not.
    expect(rows.map((row) => (row.type === 'reply' ? row.head : null))).toEqual([
      null,
      true,
      null,
      true,
      false,
      true,
    ]);
  });

  it('shows what the person chose as its own row, and a question as open until they speak after it', () => {
    const question = say({
      id: 2,
      author: 'secretary',
      text: '¿Lo anoto?',
      options: ['Anotarlo', 'Dejarlo'],
      recommended: 1,
    });
    const asked = [say({ id: 1, author: 'person' }), question];
    const open = rowsOf(asked, turnsOf(asked));
    expect(open.at(-1)).toMatchObject({ type: 'reply', question: 'open' });

    const chose = say({
      id: 3,
      author: 'person',
      replyTo: 2,
      text: 'Dejarlo',
      choice: { mode: 'option', option: 2, about: null, asked: null },
    });
    const answered = rowsOf([question, chose], turnsOf([question, chose]));
    expect(answered.map((row) => row.type)).toEqual(['reply', 'choice']);
    expect(answered[0]).toMatchObject({ question: 'answered' });

    // What they chose on an agent's question about an item is a trace: it answers no question of
    // the secretary's, and the secretary is not thinking about it.
    const trace = say({
      id: 4,
      author: 'person',
      text: 'Con musgo',
      choice: { mode: 'option', option: 2, about: 'CAM-12', asked: '¿Liso o con musgo?' },
    });
    const after = rowsOf([question, trace], turnsOf([question, trace]));
    expect(after[0]).toMatchObject({ question: 'open' });
    expect(turnsOf([trace])[0]?.waits).toBeNull();
  });

  // Each question is answered by a reply to it: another question stays open when the person
  // answers one, or says something else.
  it('keeps each question open until a reply to that one, whatever else was said', () => {
    const one = say({ id: 2, author: 'secretary', text: '¿Uno?', options: ['Sí', 'No'] });
    const two = say({ id: 3, author: 'secretary', text: '¿Dos?', options: ['Sí', 'No'] });
    const tapTwo = say({
      id: 4,
      author: 'person',
      replyTo: 3,
      text: 'Sí',
      choice: { mode: 'option', option: 1, about: null, asked: null },
    });
    const free = say({ id: 5, author: 'person', text: 'otra cosa' });

    const rows = rowsOf([one, two, tapTwo, free], turnsOf([one, two, tapTwo, free]));

    expect(rows.flatMap((row) => (row.type === 'reply' ? [row.question] : []))).toEqual([
      'open',
      'answered',
    ]);
  });
});

describe('the secretary thinking', () => {
  it('knows a message was heard the moment the wait returned it, before it was read', () => {
    const [turn] = turnsOf([
      say({ id: 1, author: 'person', delivery: 'pending', heardAt: ago(1) }),
    ]);
    expect(turn?.waits).toBe('reading');
    expect(thinkingRoot(turn ? [turn] : [], listening)).toBe(1);
  });

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

// Field study 3 (S4): without background subagents the secretary pastes the text of each session to
// open in its message; one block of plain text with no Copy, 2470 px on the phone. A fenced block
// under its number is a text to copy.
describe('texts to paste, in fenced blocks', () => {
  const text = [
    'Abre 2 sesiones más.',
    '1. Trabajador de Cambios: pega esto en una sesión nueva.',
    '```',
    'Eres un trabajador del tablero Cambios.',
    '1. Declara tu perfil: `otea profile`.',
    '```',
    '2. Refinador:',
    '```text',
    'Eres el refinador.',
    '```',
  ].join('\n');

  it('takes each numbered block out of the words, with its number and the line above as caption', () => {
    const { rest, blocks } = blocksOf(text);
    expect(blocks).toEqual([
      {
        number: 1,
        caption: 'Trabajador de Cambios: pega esto en una sesión nueva.',
        text: 'Eres un trabajador del tablero Cambios.\n1. Declara tu perfil: `otea profile`.',
      },
      { number: 2, caption: 'Refinador:', text: 'Eres el refinador.' },
    ]);
    expect(rest).toBe('Abre 2 sesiones más.');
  });

  it('leaves a text with no fence, or a fence that never closes, as it is', () => {
    expect(blocksOf('Hola.\nOtra línea.')).toEqual({ rest: 'Hola.\nOtra línea.', blocks: [] });
    const open = 'Hola.\n```\nsin cierre';
    expect(blocksOf(open)).toEqual({ rest: open, blocks: [] });
  });

  // A snippet in an ordinary reply is a code block of that reply, not a text to paste.
  it('leaves a fenced snippet of an ordinary reply in its words', () => {
    const reply = 'Corre esto y dime qué sale:\n```\nnpm test\n```\nSi falla, avísame.';
    expect(blocksOf(reply)).toEqual({ rest: reply, blocks: [] });
    // A caption that is only a number is not a numbered line of words either.
    const noCaption = 'Abre 2 sesiones.\n```\nEres el refinador.\n```';
    expect(blocksOf(noCaption).blocks).toEqual([]);
  });

  it('keeps a fence inside a longer fence as the text of the block', () => {
    const nested = [
      '1. Trabajador:',
      '````',
      'Usa esto:',
      '```',
      'otea next',
      '```',
      'Fin.',
      '````',
    ];
    expect(blocksOf(nested.join('\n'))).toEqual({
      rest: '',
      blocks: [{ number: 1, caption: 'Trabajador:', text: 'Usa esto:\n```\notea next\n```\nFin.' }],
    });
  });

  it('draws the code of an ordinary reply apart from its words', () => {
    expect(fencesOf('Corre esto:\n```sh\nnpm test\n```\nListo.')).toEqual([
      { code: false, text: 'Corre esto:' },
      { code: true, text: 'npm test' },
      { code: false, text: 'Listo.' },
    ]);
    expect(fencesOf('Solo palabras.')).toEqual([{ code: false, text: 'Solo palabras.' }]);
  });
});

describe('a reply folding', () => {
  // The first sentence does not end at the number of a list item.
  it('does not split a line after a bare number', () => {
    expect(splitReply('1. Declara tu perfil con otea profile.').lead).toBe(
      '1. Declara tu perfil con otea profile.',
    );
    expect(splitReply('Hay 3. Luego sigue.').lead).toBe('Hay 3. Luego sigue.');
  });

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

  // A reply that is one long paragraph is no headline: only its first sentence is set in the serif
  // conclusion style, the rest is body text (and folds when it is long).
  it('takes only the first sentence of a one-paragraph reply as the conclusion', () => {
    const paragraph =
      'Lo anoté en Cambios. Ya lo tomó un trabajador y está probando a 390 px. Te aviso cuando haya algo para revisar, que no debería tardar mucho.';
    const reply = splitReply(paragraph);
    expect(reply.lead).toBe('Lo anoté en Cambios.');
    expect(reply.rest).toBe(
      'Ya lo tomó un trabajador y está probando a 390 px. Te aviso cuando haya algo para revisar, que no debería tardar mucho.',
    );
    expect(reply.folds).toBe(false);
    const longer = splitReply(`${paragraph} ${paragraph} ${paragraph}`);
    expect(longer.lead).toBe('Lo anoté en Cambios.');
    expect(longer.folds).toBe(true);
  });

  it('does not end a sentence at an abbreviation, a version or a path', () => {
    expect(
      splitReply('Usa p. ej. el modo oscuro, v1.2 de change/CHA-5.x. Después sigo.').lead,
    ).toBe('Usa p. ej. el modo oscuro, v1.2 de change/CHA-5.x.');
    expect(splitReply('Mira e.g. esto y aquello. Luego más.').lead).toBe(
      'Mira e.g. esto y aquello.',
    );
  });

  it('cuts a first sentence that is itself too long at a word, so a headline is never a wall', () => {
    const wall = `${'palabra '.repeat(40).trim()}. Fin.`;
    const reply = splitReply(wall);
    expect(reply.lead.length).toBeLessThanOrEqual(141);
    expect(reply.lead.endsWith('…')).toBe(true);
    // Nothing is lost: the lead and the rest hold every word.
    expect(`${reply.lead.slice(0, -1)} ${reply.rest}`.replace(/\s+/g, ' ')).toBe(wall);
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

  it('keeps a branch name whole: an item id inside it is not a link', () => {
    const pieces = piecesOf(
      'Subí change/CHA-5-undo-delete-v2 y CHA-5 sigue en curso.',
      new Set(['CHA-5']),
    );
    expect(pieces).toEqual([
      { kind: 'text', text: 'Subí change/CHA-5-undo-delete-v2 y ' },
      { kind: 'item', id: 'CHA-5' },
      { kind: 'text', text: ' sigue en curso.' },
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

  // U4 and U1 (field study 4): a set-aside item read «en cola», an approved one read as if it were
  // done or still queued, and one taken back after a conflict said nothing of why.
  it('says set aside, approved and not landed, and back after a conflict, never queued', () => {
    const aside = item({
      id: 'CAM-16',
      turn: 'agent',
      setAside: { by: 'worker', at: ago(5) },
    });
    const landing = item({ id: 'CAM-17', turn: 'agent', landing: true });
    const bounced = item({
      id: 'CAM-18',
      turn: 'agent',
      bounced: { by: 'worker', at: ago(5), reason: 'conflicts with CAM-17' },
    });
    const items = byId(aside, landing, bounced);

    expect(chipOf('CAM-16', items, NOW).state).toBe('hablar.st.aside');
    expect(chipOf('CAM-17', items, NOW).state).toBe('hablar.st.landing');
    expect(chipOf('CAM-18', items, NOW).state).toBe('hablar.st.bounced');
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

  // The person's own tap on «consulta ⇄» makes the turn a request nothing has taken yet: it stays
  // in sight, saying the secretary is taking it, instead of vanishing from the list.
  it('keeps a request the person corrected, with no items yet, saying the secretary takes it', () => {
    const corrected = turnsOf([
      say({ id: 1, author: 'person', text: '¿Vale la pena exportar a Markdown?' }),
      say({
        id: 2,
        author: 'secretary',
        replyTo: 1,
        root: 1,
        kind: 'request',
        kindBy: 'person',
        kindNews: true,
      }),
    ]);

    const cards = cardsOf(corrected, items, NOW);

    expect(cards).toEqual([
      expect.objectContaining({ root: 1, kind: 'request', chips: [], taking: true }),
    ]);
    expect(cardCounts(corrected, items, NOW).request).toBe(1);
  });

  // A request the person corrects to a consultation after items were made from it (U4 field study
  // 4): the card keeps those items in sight and says they are still open, instead of listing only
  // an answer while CAM-10 sits in the queue unseen.
  it('keeps the items of a request corrected to a consultation, saying they are still open', () => {
    const corrected = turnsOf([
      say({ id: 1, author: 'person', text: 'agrega DELETE /orders/:id' }),
      say({
        id: 2,
        author: 'secretary',
        replyTo: 1,
        root: 1,
        kind: 'consultation',
        kindBy: 'person',
        links: ['CAM-13'],
        text: 'Anotado como cambio.',
      }),
    ]);

    expect(cardsOf(corrected, items, NOW)).toEqual([
      expect.objectContaining({
        kind: 'consultation',
        leftover: true,
        chips: [expect.objectContaining({ id: 'CAM-13' })],
      }),
    ]);
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
