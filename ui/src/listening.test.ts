import { describe, expect, it } from 'vitest';
import { instantiate, requireTemplate } from '../../src/core/board/templates.ts';
import { ago, item as fixture, inMinutes, NOW } from './derive/fixtures.ts';
import { setLanguage } from './i18n/i18n.ts';
import {
  anyoneWaits,
  goneHolder,
  handsToAgent,
  hearing,
  silentHolder,
  unheard,
  unheardLead,
  unheardWords,
  waitingToLand,
  workingAgents,
} from './listening.ts';
import type { Agent } from './presence.ts';
import { agentCounts, agentRows, pillSummary } from './shell/topbar-model.ts';
import type { Item, ItemEvent } from './types.ts';

const agent = (name: string, o: Partial<Agent> = {}): Agent => ({
  name,
  harness: 'Claude Code',
  holding: [],
  lastSeen: ago(0.5),
  live: true,
  waiting: false,
  ...o,
});

const item = (o: Partial<Item> = {}): Item =>
  fixture({ id: 'TASK-1', turn: 'agent', lease: null, ...o });

describe('anyoneWaits', () => {
  it('is true once one agent waits in otea wait', () => {
    expect(anyoneWaits([agent('a'), agent('b', { waiting: true })])).toBe(true);
  });

  it('is false when the agents only have their MCP server open, or none is there', () => {
    expect(anyoneWaits([agent('a', { listening: true })])).toBe(false);
    expect(anyoneWaits([])).toBe(false);
  });

  it('never claims a silence it cannot tell: before presence loads, or from a server that does not say', () => {
    expect(anyoneWaits(undefined)).toBe(true);
    expect(anyoneWaits(null)).toBe(true);
    const { waiting: _, ...older } = agent('a');
    expect(anyoneWaits([older])).toBe(true);
  });
});

describe('unheard', () => {
  it('marks an item on the agent turn that nobody holds while no agent waits', () => {
    expect(unheard(item(), [agent('a')], NOW)).toBe(true);
    expect(unheard(item(), [agent('a', { waiting: true })], NOW)).toBe(false);
  });

  it('leaves alone what is yours or closed', () => {
    expect(unheard(item({ turn: 'human' }), [], NOW)).toBe(false);
    expect(unheard(item({ turn: 'none' }), [], NOW)).toBe(false);
  });

  it('leaves alone an item its holder works on now, and marks one whose holder went idle', () => {
    const lease = { holder: 'a', expiresAt: inMinutes(10) };
    expect(unheard(item({ lease }), [agent('a')], NOW)).toBe(false);
    expect(unheard(item({ lease }), [agent('a', { lastSeen: ago(10) })], NOW)).toBe(true);
  });

  // P7-R3-10: its lease keeps the item after the session ended, but nobody does it.
  it('marks an item whose holder is no longer connected, though it was seen moments ago', () => {
    const lease = { holder: 'a', expiresAt: inMinutes(10) };
    expect(unheard(item({ lease }), [agent('a', { live: false })], NOW)).toBe(true);
  });

  // P7-R3-1: the only agent set it aside for later; the desk says that instead of an alarm.
  it('leaves alone an item an agent set aside for later', () => {
    const setAside = { by: 'a', at: ago(3) };
    expect(unheard(item({ setAside }), [agent('a')], NOW)).toBe(false);
  });
});

// P7-R3-10: after /exit the item read «claude-haiku lo está haciendo» until its lease ran out.
describe('goneHolder', () => {
  const lease = { holder: 'a', expiresAt: inMinutes(10) };

  it('names the holder of a live lease once it is no longer connected', () => {
    expect(goneHolder(item({ lease }), [agent('a', { live: false })], NOW)?.name).toBe('a');
  });

  it('names none while it is connected, with no live lease, or before presence loads', () => {
    expect(goneHolder(item({ lease }), [agent('a')], NOW)).toBeNull();
    const ran = { holder: 'a', expiresAt: ago(1) };
    expect(goneHolder(item({ lease: ran }), [agent('a', { live: false })], NOW)).toBeNull();
    expect(goneHolder(item({ lease }), undefined, NOW)).toBeNull();
    expect(goneHolder(item({ lease }), [], NOW)).toBeNull();
  });
});

// P7-R2-9, P7-R2-12: a review read «Nadie está escuchando» in red while claude-haiku plainly
// worked, and every queued item did while it worked on another: an agent at work sees what the
// person hands it when it waits again, and what nobody hears waits in its queue.
describe('workingAgents', () => {
  const lease = { holder: 'a', expiresAt: inMinutes(10) };
  const items = [item({ id: 'TASK-2', lease })];

  it('names the agents at work on an item they hold, however long since their last call', () => {
    // Its MCP server beats while it works a long step with no call: the server counts it connected.
    const beating = { holding: ['TASK-2'], listening: true, actedAt: ago(20) };
    expect(workingAgents([agent('a', beating), agent('b')], items, NOW)).toEqual(['a']);
  });

  // The server says who is at work (status): the desk names exactly those, derives none itself.
  it('names an agent the server says is working though it holds nothing', () => {
    const called = { actedAt: ago(1), status: 'working' as const };
    expect(workingAgents([agent('a', called)], items, NOW)).toEqual(['a']);
    const idle = { actedAt: ago(10), status: 'connected' as const };
    expect(workingAgents([agent('a', idle)], items, NOW)).toEqual([]);
  });

  // P7-R2-9: between two items its wait had just found work, so it was still heard listening, and
  // the desk read it as idle in its chat: red in 8 of 20 samples.
  it('names an agent between two items whose wait just ended, as it calls Otea', () => {
    const between = { listening: true, actedAt: ago(0.5), status: 'working' as const };
    expect(workingAgents([agent('a', between)], items, NOW)).toEqual(['a']);
  });

  // An open MCP server is heard on its beats, so a fresh sighting is no call: idle in its chat, it
  // hears nothing of the desk.
  it('names no agent only heard through its open MCP server, holding nothing', () => {
    expect(
      workingAgents([agent('a', { listening: true, lastSeen: ago(0.5) })], items, NOW),
    ).toEqual([]);
  });

  it('names none that only waits for your answer, nor one gone', () => {
    const asks = { question: 1, by: 'a', text: 'Which one?', at: ago(1) };
    const asking = [item({ id: 'TASK-2', lease, asks })];
    const waits = { holding: ['TASK-2'], status: 'connected' as const };
    expect(workingAgents([agent('a', waits)], asking, NOW)).toEqual([]);
    const gone = { live: false, holding: ['TASK-2'], actedAt: ago(1), status: 'away' as const };
    expect(workingAgents([agent('a', gone)], items, NOW)).toEqual([]);
  });
});

describe('hearing', () => {
  it('says nothing while an agent waits, and before presence loads', () => {
    expect(hearing([agent('a', { waiting: true }), agent('b')], [], NOW)).toBeNull();
    expect(hearing(undefined, [], NOW)).toBeNull();
  });

  it('names the agents at work while none waits, else raises the alarm', () => {
    const called = agent('a', { actedAt: ago(1), status: 'working' });
    expect(hearing([called], [], NOW)).toEqual({ kind: 'working', agents: ['a'] });
    const idle = agent('a', { actedAt: ago(10), status: 'connected' });
    expect(hearing([idle], [], NOW)).toEqual({ kind: 'unheard' });
    // Connected and idle in its chat: nobody hears the desk, and that is the alarm.
    expect(hearing([agent('a', { listening: true })], [], NOW)).toEqual({ kind: 'unheard' });
  });

  // «Nadie está escuchando» in red read as a fault when no agent existed at all: that is not a
  // silence to fix, it is an empty room, said calmly.
  it('says no agent is connected, not that nobody listens, when there is none', () => {
    expect(hearing([], [], NOW)).toEqual({ kind: 'nobody' });
    expect(hearing([agent('a', { live: false })], [], NOW)).toEqual({ kind: 'nobody' });
    expect(unheardWords([], true)).toEqual({ text: 'no agent is connected', calm: true });
  });
});

describe('one status, one count', () => {
  const lease = { holder: 'a', expiresAt: inMinutes(10) };
  const items = [item({ id: 'TASK-2', lease })];

  // After its handoff the agent was still «trabajando» for the listening window.
  it('does not count an agent that handed off, though it called Otea a moment ago', () => {
    const handed = agent('a', { actedAt: ago(0.5), status: 'connected' });
    expect(workingAgents([handed], items, NOW)).toEqual([]);
    expect(agentRows([handed], items, NOW)[0]?.working).toBe(false);
  });

  // «4 ocupados» beside a pill of 3: the queue note counted whoever called lately, the pill only
  // whoever held an item.
  it('counts the same agents on the pill and in the queue note', () => {
    const asks = { question: 1, by: 'c', text: 'Which?', at: ago(1) };
    const all = [
      item({ id: 'TASK-2', lease }),
      item({ id: 'TASK-3', lease: { holder: 'c', expiresAt: inMinutes(10) }, asks }),
    ];
    // The server says what each is: c waits for your answer, so it is connected, not working.
    const agents = [
      agent('a', { holding: ['TASK-2'], status: 'working' }),
      agent('b', { actedAt: ago(0.5), status: 'working' }),
      agent('c', { holding: ['TASK-3'], status: 'connected' }),
      agent('d', { status: 'connected' }),
    ];
    const rows = agentRows(agents, all, NOW);
    expect(workingAgents(agents, all, NOW)).toEqual(['a', 'b']);
    expect(agentCounts(rows).holding).toBe(2);
    expect(rows.filter((row) => row.working).map((row) => row.name)).toEqual(['a', 'b']);
  });

  // An agent working a long step over the command line gave no sign for a while: the desk said
  // «Ningún agente conectado» over it, and its menu did not list it at all.
  describe('an agent silent on a live lease', () => {
    const silent = agent('a', { live: false, holding: ['TASK-2'], status: 'silent' });

    it('is listed in the menu as «sin señal», and the pill counts what the menu lists', () => {
      const rows = agentRows([silent], items, NOW);
      expect(rows.map((row) => [row.name, row.state, row.silent])).toEqual([['a', 'silent', true]]);
      expect(agentCounts(rows)).toMatchObject({ live: 0, silent: 1, holding: 0 });
      expect(pillSummary('live', rows)).toEqual({ kind: 'silent', count: 1 });
      expect(hearing([silent], [], NOW)).toEqual({ kind: 'unheard' });
    });

    it('shows beside the agents that are connected, as the pill’s datum', () => {
      const rows = agentRows(
        [silent, agent('b', { holding: ['TASK-2'], status: 'working' })],
        items,
        NOW,
      );
      expect(rows).toHaveLength(2);
      expect(pillSummary('live', rows)).toEqual({
        kind: 'working',
        count: 1,
        extra: { kind: 'silent', n: 1 },
      });
    });

    it('leaves the empty room to a project with no agent at all', () => {
      expect(pillSummary('live', agentRows([], items, NOW))).toEqual({ kind: 'none' });
    });
  });
});

// P4-R3-5: on the person's own chore, red «Nadie está escuchando… otea wait» showed though what
// they do there closes the item or keeps it theirs: no agent needs to listen.
describe('handsToAgent', () => {
  const choice = (turn: string) => ({ move: { turn } });

  it('says so only when one of the moves offered lands on an agent', () => {
    expect(handsToAgent([choice('none'), choice('human')])).toBe(false);
    expect(handsToAgent([null, choice('none'), choice('agent')])).toBe(true);
    expect(handsToAgent([])).toBe(false);
  });
});

// P6-R3-5: after «Retomar», the desk said «claude-a está ocupado con otro ítem» while claude-a held
// nothing: it was claiming this very item. «Busy with another item» is said only of an agent that
// holds another one; one at work holding none is only at work.
describe('unheardLead', () => {
  // An agent at work is no silence: the desk does not open with the alarm for it, only with the
  // plain fact, so a person watching agents work is never told that nobody is there.
  it('never opens with "nobody is listening" while an agent is at work', () => {
    const free = agent('claude-a', { holding: [], actedAt: ago(0.5) });
    for (const lang of ['en', 'es'] as const) {
      setLanguage(lang);
      expect(unheardLead(['claude-a'], [free], 'TASK-1')).not.toMatch(/nobody|nadie/i);
      expect(unheardLead(['claude-a', 'claude-b'], [free], 'TASK-1')).not.toMatch(/nobody|nadie/i);
    }
    setLanguage('en');
  });

  it('says an agent is busy with another item only when it holds one', () => {
    setLanguage('es');
    const busy = agent('claude-a', { holding: ['TASK-2'] });
    expect(unheardLead(['claude-a'], [busy], 'TASK-1')).toBe(
      'claude-a está trabajando en otro ítem; lo verá cuando vuelva a esperar.',
    );
    const free = agent('claude-a', { holding: [], actedAt: ago(0.5) });
    expect(unheardLead(['claude-a'], [free], 'TASK-1')).toBe(
      'claude-a está trabajando y lo verá cuando vuelva a esperar.',
    );
    const here = agent('claude-a', { holding: ['TASK-1'] });
    expect(unheardLead(['claude-a'], [here], 'TASK-1')).toBe(
      'claude-a está trabajando y lo verá cuando vuelva a esperar.',
    );
    setLanguage('en');
    expect(unheardLead(['claude-a'], [free], 'TASK-1')).toBe(
      'claude-a is at work and will see it when it waits again.',
    );
    expect(unheardLead([], [free], 'TASK-1')).toBe('Nobody is listening.');
  });
});

// P6-R3-4: the holder's question was answered, it ran no wait and made no otea call since, and the
// desk said «lo hace claude-haiku · quedan 10 min» for 13 minutes while two items waited behind it.
// Only an answer it never picked up says so: a long step with no call is still at work (#477).
describe('silentHolder', () => {
  const lease = { holder: 'a', expiresAt: inMinutes(10) };
  const said = (id: number, type: string, by: 'a' | 'fede', minutesAgo: number): ItemEvent => ({
    id,
    type,
    actor: by === 'a' ? { kind: 'agent', name: 'a' } : { kind: 'human', name: 'fede' },
    at: ago(minutesAgo),
    data: { question: 1 },
  });
  const asked = said(1, 'question_asked', 'a', 12);
  const answered = said(2, 'question_answered', 'fede', 10);

  it('names the holder that made no call since its question was answered and waits for nothing', () => {
    const quiet = agent('a', { holding: ['TASK-1'], listening: true, actedAt: ago(11) });
    expect(silentHolder(item({ lease }), [quiet], [asked, answered], NOW)).toEqual({
      agent: 'a',
      since: ago(10),
    });
  });

  it('names none once it called Otea after the answer, or while it waits', () => {
    const called = agent('a', { holding: ['TASK-1'], actedAt: ago(4) });
    expect(silentHolder(item({ lease }), [called], [asked, answered], NOW)).toBeNull();
    const waits = agent('a', { holding: ['TASK-1'], waiting: true, actedAt: ago(11) });
    expect(silentHolder(item({ lease }), [waits], [asked, answered], NOW)).toBeNull();
  });

  it('gives it a moment to pick the answer up', () => {
    const quiet = agent('a', { holding: ['TASK-1'], actedAt: ago(3) });
    const justNow = { ...answered, at: ago(1) };
    expect(silentHolder(item({ lease }), [quiet], [asked, justNow], NOW)).toBeNull();
  });

  it('keeps a long step with no call at work: no question answered, no word of it', () => {
    const working = agent('a', { holding: ['TASK-1'], listening: true, actedAt: ago(40) });
    expect(silentHolder(item({ lease }), [working], [], NOW)).toBeNull();
    // A question another agent asked is not the holder's.
    const theirs = { ...asked, actor: { kind: 'agent' as const, name: 'b' } };
    expect(silentHolder(item({ lease }), [working], [theirs, answered], NOW)).toBeNull();
  });

  it('names none with no live lease, or before presence loads', () => {
    const quiet = agent('a', { actedAt: ago(11) });
    expect(silentHolder(item(), [quiet], [asked, answered], NOW)).toBeNull();
    expect(silentHolder(item({ lease }), undefined, [asked, answered], NOW)).toBeNull();
  });
});

// P6-R3-4: CAM-1 and CAM-2, approved, waited 13 min behind the silent holder's landing in main.
describe('waitingToLand', () => {
  const def = instantiate(requireTemplate('changes'), 'es', {}, undefined, { keep: true });
  const lease = { holder: 'a', expiresAt: inMinutes(10) };
  const on = (id: string, state: string, o: Partial<Item> = {}) =>
    item({ id, collection: def.name, state, ...o });

  it('names the items on the same land step that nobody holds', () => {
    const landing = on('CAM-4', 'land', { lease });
    const all = [
      landing,
      on('CAM-1', 'land'),
      on('CAM-2', 'land'),
      on('CAM-3', 'doit'),
      on('CAM-5', 'land', { lease: { holder: 'b', expiresAt: inMinutes(5) } }),
      item({ id: 'TASK-9', state: 'land' }),
    ];
    expect(waitingToLand(landing, all, def, NOW)).toEqual(['CAM-1', 'CAM-2']);
  });

  it('names none off a land step, or off a board', () => {
    const doing = on('CAM-3', 'doit', { lease });
    expect(waitingToLand(doing, [doing, on('CAM-6', 'doit')], def, NOW)).toEqual([]);
    expect(waitingToLand(doing, [doing], undefined, NOW)).toEqual([]);
  });
});
