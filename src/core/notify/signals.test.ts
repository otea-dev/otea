import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_WAIT_MS,
  type AssistantFacts,
  assistantSignalsOf,
  bandejaSignalsOf,
  freshSignals,
  type NotifyFacts,
  settleUnheard,
  signalsOf,
  UNHEARD_GRACE_MS,
} from './signals.ts';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const later = '2026-11-14T10:10:00.000Z';
const earlier = '2026-11-14T09:50:00.000Z';

const item = (over: Partial<NotifyFacts> = {}): NotifyFacts => ({
  id: 'TASKS-1',
  title: 'Ship the login',
  state: 'build__review',
  turn: 'human',
  lease: null,
  ...over,
});

const kinds = (facts: NotifyFacts[]) => signalsOf(facts, NOW).map(({ kind }) => kind);

describe('signalsOf', () => {
  it('says an item on your turn is yours: a review', () => {
    expect(signalsOf([item()], NOW)).toEqual([
      {
        key: 'turn:TASKS-1:build__review:',
        kind: 'turn',
        item: 'TASKS-1',
        title: 'Ship the login',
      },
    ]);
  });

  it('says who asks when an agent’s question waits for you', () => {
    const signals = signalsOf(
      [item({ asks: { question: 2, by: 'claude', text: 'Which port?' } })],
      NOW,
    );
    expect(signals).toEqual([
      {
        key: 'turn:TASKS-1:build__review::q2',
        kind: 'ask',
        item: 'TASKS-1',
        title: 'Ship the login',
        by: 'claude',
        text: 'Which port?',
      },
    ]);
  });

  it('carries the options a question offers', () => {
    const asks = { question: 2, by: 'claude', options: ['A', 'B'] };
    expect(signalsOf([item({ asks })], NOW)[0]).toMatchObject({ kind: 'ask', options: ['A', 'B'] });
  });

  it('says an agent set an item aside for later, once per set-aside', () => {
    const aside = item({
      turn: 'agent',
      lease: null,
      setAside: { by: 'kiln', at: earlier },
    });
    expect(signalsOf([aside], NOW)).toEqual([
      {
        key: `aside:TASKS-1:kiln:${earlier}`,
        kind: 'aside',
        item: 'TASKS-1',
        title: 'Ship the login',
        by: 'kiln',
      },
    ]);
  });

  it('tells a new round on your turn from the one before', () => {
    const [one] = signalsOf([item({ round: 1 })], NOW);
    const [two] = signalsOf([item({ round: 2 })], NOW);
    expect(one?.key).not.toBe(two?.key);
  });

  it('says nothing of an item on an agent’s turn that is moving, or one that is closed', () => {
    expect(kinds([item({ turn: 'agent', lease: { holder: 'claude', expiresAt: later } })])).toEqual(
      [],
    );
    expect(kinds([item({ turn: 'none' })])).toEqual([]);
  });

  it('says an item got stuck when its agent’s lease ran out with nobody taking it', () => {
    const stuck = item({
      turn: 'agent',
      lease: null,
      expiredLease: { holder: 'codex', expiresAt: earlier },
    });
    expect(signalsOf([stuck], NOW)).toEqual([
      {
        key: `stuck:TASKS-1:codex:${earlier}`,
        kind: 'stuck',
        item: 'TASKS-1',
        title: 'Ship the login',
        by: 'codex',
      },
    ]);
  });

  it('says an item waits for an agent when nobody listens, once per state', () => {
    const waiting = item({ turn: 'agent', lease: null, unheard: true });
    expect(signalsOf([waiting], NOW)).toEqual([
      {
        key: 'unheard:TASKS-1:build__review:',
        kind: 'unheard',
        item: 'TASKS-1',
        title: 'Ship the login',
      },
    ]);
    const next = signalsOf([{ ...waiting, state: 'build__test', round: 2 }], NOW);
    expect(next[0]?.key).not.toBe('unheard:TASKS-1:build__review:');
    expect(kinds([item({ turn: 'agent', lease: null })])).toEqual([]);
  });

  it('says an agent answered your note, once per answer', () => {
    const answered = item({
      turn: 'agent',
      lease: { holder: 'claude', expiresAt: later },
      notes: { replied: { note: 3, by: 'claude', at: earlier } },
    });
    expect(signalsOf([answered], NOW)).toEqual([
      {
        key: `replied:TASKS-1:3:${earlier}`,
        kind: 'replied',
        item: 'TASKS-1',
        title: 'Ship the login',
        by: 'claude',
      },
    ]);
  });
});

describe('settleUnheard', () => {
  const keyOf = (id: string) => `${id}:s:`;

  it('tells an item only after it stayed unheard for the grace', () => {
    const since = new Map<string, number | null>();
    const one = new Set([keyOf('A')]);
    expect(settleUnheard(since, one, NOW, false).size).toBe(0);
    expect(settleUnheard(since, one, NOW + UNHEARD_GRACE_MS - 1, false).size).toBe(0);
    expect([...settleUnheard(since, one, NOW + UNHEARD_GRACE_MS, false)]).toEqual([keyOf('A')]);
  });

  it('starts over when the item was heard in between', () => {
    const since = new Map<string, number | null>();
    const one = new Set([keyOf('A')]);
    settleUnheard(since, one, NOW, false);
    settleUnheard(since, new Set(), NOW + 60_000, false);
    settleUnheard(since, one, NOW + 90_000, false);
    expect(settleUnheard(since, one, NOW + UNHEARD_GRACE_MS + 1000, false).size).toBe(0);
    expect(settleUnheard(since, one, NOW + 90_000 + UNHEARD_GRACE_MS, false).size).toBe(1);
  });

  it('never tells what was already unheard when watching began, until it is heard again', () => {
    const since = new Map<string, number | null>();
    const one = new Set([keyOf('A')]);
    settleUnheard(since, one, NOW, true);
    expect(settleUnheard(since, one, NOW + 10 * UNHEARD_GRACE_MS, false).size).toBe(0);
    settleUnheard(since, new Set(), NOW + 11 * UNHEARD_GRACE_MS, false);
    settleUnheard(since, one, NOW + 12 * UNHEARD_GRACE_MS, false);
    expect(settleUnheard(since, one, NOW + 13 * UNHEARD_GRACE_MS, false).size).toBe(1);
  });
});

describe('assistantSignalsOf', () => {
  const facts = (over: Partial<AssistantFacts> = {}): AssistantFacts => ({
    name: 'sage',
    state: 'offline',
    since: earlier,
    replies: [],
    waiting: { count: 2, since: '2026-11-14T09:45:00.000Z' },
    ...over,
  });

  it('says nothing while the project has no assistant', () => {
    expect(assistantSignalsOf(undefined, NOW)).toEqual([]);
  });

  it('tells each reply under its own key, at the turn it answered', () => {
    const replies = [{ id: 9, turn: 4, by: 'sage', text: 'Listo' }];
    expect(assistantSignalsOf(facts({ state: 'listening', replies }), NOW)).toEqual([
      {
        key: 'assistant_reply:9',
        kind: 'assistant_reply',
        item: 'hablar:4',
        title: '',
        by: 'sage',
        turn: 4,
        text: 'Listo',
      },
    ]);
  });

  it('tells an offline assistant only once messages have waited the threshold', () => {
    const waiting = (since: string) => ({ count: 2, since });
    const kindsAt = (since: string, state: AssistantFacts['state'] = 'offline') =>
      assistantSignalsOf(facts({ state, waiting: waiting(since) }), NOW).map(({ kind }) => kind);
    expect(kindsAt(new Date(NOW - ASSISTANT_WAIT_MS + 1000).toISOString())).toEqual([]);
    expect(kindsAt(new Date(NOW - ASSISTANT_WAIT_MS).toISOString())).toEqual(['assistant_offline']);
    expect(kindsAt(new Date(NOW - 2 * ASSISTANT_WAIT_MS).toISOString(), 'connected')).toEqual([]);
    expect(assistantSignalsOf(facts({ waiting: { count: 0, since: null } }), NOW)).toEqual([]);
  });

  it('keys the offline notice to the stretch, not to what waits', () => {
    const key = (over: Partial<AssistantFacts>) => assistantSignalsOf(facts(over), NOW)[0]?.key;
    expect(key({ waiting: { count: 5, since: '2026-11-14T09:45:00.000Z' } })).toBe(
      key({ waiting: { count: 2, since: '2026-11-14T09:30:00.000Z' } }),
    );
    expect(key({ since: '2026-11-14T09:55:00.000Z' })).not.toBe(key({}));
  });
});

describe('freshSignals', () => {
  const yours = signalsOf([item()], NOW);

  it('takes the first look as the starting point: nothing is new yet', () => {
    expect(freshSignals(undefined, yours)).toEqual([]);
  });

  it('keeps what was not there the last time', () => {
    expect(freshSignals(new Set(), yours)).toEqual(yours);
    expect(freshSignals(new Set(yours.map(({ key }) => key)), yours)).toEqual([]);
  });
});

describe('bandejaSignalsOf', () => {
  const ask = {
    ref: 'B-3',
    snippet: 'El botón Aprobar queda tapado',
    question: 1,
    by: 'lia',
    text: '¿Solo Aprobar o todas?',
    options: ['Solo Aprobar', 'Todas'],
  };

  it('tells each unanswered question as an ask, under a key of its own that changes with the question', () => {
    expect(bandejaSignalsOf([ask])).toEqual([
      {
        key: 'bandeja:B-3:q1',
        kind: 'ask',
        item: 'B-3',
        bandeja: true,
        title: 'El botón Aprobar queda tapado',
        by: 'lia',
        text: '¿Solo Aprobar o todas?',
        options: ['Solo Aprobar', 'Todas'],
      },
    ]);
    expect(bandejaSignalsOf([{ ...ask, question: 2 }])[0]?.key).toBe('bandeja:B-3:q2');
    expect(bandejaSignalsOf([])).toEqual([]);
  });

  it('leaves out the options a question has none of', () => {
    const [signal] = bandejaSignalsOf([{ ...ask, options: undefined }]);
    expect(signal).not.toHaveProperty('options');
  });
});
