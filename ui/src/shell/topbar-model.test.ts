import { afterEach, describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../src/core/agent-status.ts';
import { agent as actor, ago, inMinutes, item, moved, NOW } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import type { Agent } from '../presence.ts';
import type { ProjectAgent, ProjectOverview } from '../types.ts';
import {
  agentCounts,
  agentRows,
  elsewhereLine,
  pillConnection,
  pillMark,
  pillSummary,
  projectRows,
} from './topbar-model.ts';

afterEach(() => setLanguage('en'));

const overview = (o: Partial<ProjectOverview> & { id: string }): ProjectOverview => ({
  name: o.id,
  storage: 'common',
  current: false,
  paths: [{ path: `/repos/${o.id}`, missing: false }] as ProjectOverview['paths'],
  waiting: [],
  withAgents: 0,
  open: 0,
  ...o,
});
const waiting = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `W-${i}` })) as unknown as ProjectOverview['waiting'];

const agent = (name: string, o: Partial<Agent> = {}): Agent => ({
  name,
  harness: null,
  holding: [],
  lastSeen: ago(1),
  live: true,
  ...o,
});

describe('the project menu’s rows', () => {
  const here = { id: 'hm', name: 'Hollowmere', icon: null };

  // F4 review round: a question on a note in another project is something waiting for you there.
  it('counts what asks you in another project, though no item waits', () => {
    setLanguage('es');
    const ask = { kind: 'bandeja', ref: 'B-1', title: 'x', since: null } as const;
    const { rows, total } = projectRows(
      here,
      [overview({ id: 'mirefall', asking: [ask] }), overview({ id: 'hm', current: true })],
      0,
    );

    expect(rows.find(({ id }) => id === 'mirefall')).toMatchObject({ waiting: 1 });
    expect(total).toBe(1);
  });

  it('puts the project open now first, with your count, a tick and no address', () => {
    setLanguage('es');
    const { rows } = projectRows(
      here,
      [
        overview({ id: 'mirefall', waiting: waiting(2) }),
        overview({ id: 'hm', name: 'Hollowmere', current: true, waiting: waiting(9) }),
      ],
      3,
    );
    expect(rows[0]).toMatchObject({
      id: 'hm',
      current: true,
      line: '3 te esperan',
      waiting: 3,
      inert: false,
    });
    expect(rows[0]?.href).toBeUndefined();
  });

  it('says the project is open now while nothing waits and no agent works there', () => {
    setLanguage('es');
    const { rows } = projectRows(here, [overview({ id: 'hm', current: true })], 0);
    expect(rows[0]?.line).toBe('abierto ahora');
  });

  it('opens another project at its page on this server, keeping where it lives for a tooltip', () => {
    const { rows } = projectRows(here, [overview({ id: 'mirefall', waiting: waiting(2) })], 0);
    expect(rows.find((r) => r.id === 'mirefall')).toMatchObject({
      href: '/p/mirefall/#/',
      line: '2 wait for you',
      where: '/repos/mirefall',
      waiting: 2,
      inert: false,
    });
  });

  // P6-F7: every row says what is going on there, in the server's words for each agent.
  it('says in each row what waits for you and how many agents work, in the server’s words', () => {
    setLanguage('es');
    const agent = (name: string, status: AgentStatus): ProjectAgent => ({
      name,
      status,
      holding: 1,
    });
    const { rows } = projectRows(
      here,
      [
        overview({
          id: 'busy',
          waiting: waiting(2),
          agents: [
            agent('kiln', 'working'),
            agent('quill', 'working'),
            agent('mender', 'silent'),
            agent('scout', 'listening'),
          ],
        }),
        overview({
          id: 'calm',
          agents: [agent('scout', 'listening')],
        }),
        overview({ id: 'old' }),
      ],
      0,
    );
    expect(rows.find((r) => r.id === 'busy')?.line).toBe(
      '2 te esperan · 2 trabajando · 1 sin novedades',
    );
    // An away agent (it left an item stuck) says «ausente», apart from «sin señal».
    const away = projectRows(
      here,
      [
        overview({
          id: 'gone',
          agents: [agent('mender', 'silent'), agent('ghost', 'away'), agent('scout', 'listening')],
        }),
      ],
      0,
    ).rows.find((r) => r.id === 'gone');
    expect(away?.line).toBe('1 sin novedades · 1 ausente');
    // Listening is not at work: nothing to report; an older server that sends no agents is the same.
    expect(rows.find((r) => r.id === 'calm')?.line).toBe('nada te espera');
    expect(rows.find((r) => r.id === 'old')?.line).toBe('nada te espera');
  });

  it('keeps a project it cannot read inert, saying so', () => {
    setLanguage('es');
    const { rows } = projectRows(here, [overview({ id: 'quiet', unavailable: 'gone' })], 0);
    expect(rows.find((r) => r.id === 'quiet')).toMatchObject({
      inert: true,
      line: 'no se puede leer ahora',
    });
  });

  // The path is in the row's own line, on the phone too: a tooltip is nothing there.
  it('says when a folder is missing, with its path, on the computer and on the phone', () => {
    const gone = overview({
      id: 'gone',
      paths: [{ path: '/old', missing: true }] as ProjectOverview['paths'],
    });
    const line = (phone: boolean) =>
      projectRows(here, [gone], 0, phone).rows.find((r) => r.id === 'gone')?.line;
    expect(line(false)).toBe('folder missing · /old');
    expect(line(true)).toBe('folder missing · /old');
    setLanguage('es');
    expect(line(false)).toBe('falta la carpeta · /old');
  });

  // P6-17: a folder on the computer means nothing on the phone, and a Windows path is noise there.
  it('says on the phone what waits in each project, never its folder', () => {
    setLanguage('es');
    const { rows } = projectRows(
      here,
      [
        overview({ id: 'mirefall', waiting: waiting(2) }),
        overview({ id: 'quiet', waiting: waiting(0) }),
      ],
      0,
      true,
    );
    expect(rows.find((r) => r.id === 'mirefall')?.line).toBe('2 te esperan');
    expect(rows.find((r) => r.id === 'quiet')?.line).toBe('nada te espera');
    expect(rows.map((r) => r.line).join(' ')).not.toContain('/repos/');
  });

  it('adds every waiting count for Todos los proyectos', () => {
    const { total } = projectRows(
      here,
      [
        overview({ id: 'hm', current: true, waiting: waiting(9) }),
        overview({ id: 'a', waiting: waiting(2) }),
        overview({ id: 'b', waiting: waiting(1) }),
      ],
      7,
    );
    expect(total).toBe(10);
  });

  it('lists the project alone before the server answers', () => {
    const { rows, total } = projectRows(here, undefined, 4);
    expect(rows.map((r) => [r.id, r.current, r.waiting])).toEqual([['hm', true, 4]]);
    expect(total).toBe(4);
  });
});

describe('the Elsewhere line', () => {
  it('counts what waits in other projects, in the mock’s words', () => {
    setLanguage('es');
    const line = elsewhereLine([
      overview({ id: 'hm', current: true, waiting: waiting(5) }),
      overview({ id: 'a', waiting: waiting(2) }),
      overview({ id: 'b', waiting: waiting(1) }),
      overview({ id: 'c' }),
    ]);
    expect(line).toBe('3 más te esperan en 2 proyectos');
  });

  it('says nothing while nothing waits elsewhere', () => {
    expect(elsewhereLine([overview({ id: 'hm', current: true, waiting: waiting(5) })])).toBe(null);
    expect(elsewhereLine(undefined)).toBe(null);
  });
});

describe('the agents menu’s rows', () => {
  const items = [
    item({
      id: 'ERR-231',
      title: 'Huecos en la colisión',
      turn: 'agent',
      lease: { holder: 'Scout', expiresAt: inMinutes(30) },
    }),
    item({
      id: 'CRE-44',
      title: 'Tortuga musgosa',
      turn: 'agent',
      lease: null,
      expiredLease: { holder: 'Kiln', expiresAt: ago(12) },
    }),
    item({ id: 'TAR-7', title: 'Paginar la API', turn: 'human', state: 'verify' }),
  ];
  const feed = [moved('TAR-7', 'verify', actor('Quill'), { reason: '¿Por cursor?', minutes: 3 })];
  const opus = { harness: 'claude-code', model: 'opus', effort: 'high', family: 'opus' };

  it('lists each connected agent with its harness, profile and what it holds, as a mini node', () => {
    const rows = agentRows(
      [
        agent('Scout', {
          harness: 'Claude Code',
          holding: ['ERR-231'],
          profile: opus,
          profileConfirmed: true,
          profileChangedAt: ago(20),
        }),
      ],
      items,
      NOW,
    );
    expect(rows[0]).toMatchObject({
      name: 'Scout',
      harness: 'Claude Code',
      profile: opus,
      confirmed: true,
      changedAt: ago(20),
      held: [{ id: 'ERR-231', title: 'Huecos en la colisión', look: 'working' }],
      state: 'work',
      quiet: false,
    });
  });

  it('says an agent waits for your answer while its question waits, on an item it holds', () => {
    const asked = item({
      id: 'CRI-1',
      title: 'Tortuga',
      state: 'sconcept',
      lease: { holder: 'Kiln', expiresAt: inMinutes(30) },
      asks: { question: 1, by: 'Kiln', text: '¿Liso?', at: ago(5) },
    });
    // The server says a holder waiting for its answer is connected, not working.
    const kiln = agent('Kiln', { holding: ['CRI-1'], status: 'connected' });
    const [row] = agentRows([kiln], [asked], NOW);
    expect(row).toMatchObject({ state: 'wait', working: false, item: { id: 'CRI-1' } });
  });

  // H2 (field study 4): a worker at a long step whose session runs is working, never «sin señal»;
  // past a quarter of an hour with no sign the menu only says, softly, how long it has been quiet.
  it('says how long a working agent has been quiet once it is past a quarter of an hour', () => {
    const held = item({
      id: 'CRE-50',
      title: 'Pruebas largas',
      state: 'sconcept',
      lease: { holder: 'Kiln', expiresAt: inMinutes(10) },
    });
    const working = (quiet: number) =>
      agentRows(
        [agent('Kiln', { holding: ['CRE-50'], status: 'working', lastSeen: ago(quiet) })],
        [held],
        NOW,
      )[0];

    expect(working(5)).toMatchObject({ state: 'work', silent: false, hushed: null });
    expect(working(20)).toMatchObject({ state: 'work', silent: false, hushed: 20 });
  });

  it('tags a command-line agent with the harness its profile names', () => {
    const [row] = agentRows([agent('Quill', { harness: 'cli', profile: opus })], items, NOW);
    expect(row?.harness).toBe('claude-code');
    const [mcp] = agentRows([agent('Scout', { harness: 'codex', profile: opus })], items, NOW);
    expect(mcp?.harness).toBe('codex');
    expect(agentRows([agent('Ivy', { harness: 'cli' })], items, NOW)[0]?.harness).toBe('cli');
  });

  // Review of #605: a connected agent whose lease lapsed mid-step may still be at work (lease-take.ts
  // refuses to take the item while its session runs). It is neither «libre» nor «sin señal»: the
  // server says it is connected, and the row names the item whose lease ran out.
  it('keeps a connected agent whose lease ran out connected, naming the stuck item', () => {
    const kiln = agent('Kiln', { status: 'connected', waiting: false, lastSeen: ago(0.5) });
    const rows = agentRows([kiln], items, NOW);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Kiln',
        state: 'idle',
        silent: false,
        quiet: false,
        working: false,
        lapsed: { id: 'CRE-44', title: 'Tortuga musgosa', at: Date.parse(ago(12)) },
      }),
    ]);
    expect(agentCounts(rows)).toMatchObject({ connected: 1, silent: 0, live: 1 });
    expect(pillSummary('live', rows)).toMatchObject({ kind: 'connected', count: 1 });
    // Listening in otea wait, it reads listening, with the same lapsed lease.
    const waits = agentRows([{ ...kiln, status: 'listening', waiting: true }], items, NOW);
    expect(waits[0]).toMatchObject({ state: 'idle', waiting: true, lapsed: { id: 'CRE-44' } });
    // One that is not connected is the silent one, and has no lapsed lease of its own to defend.
    const gone = agentRows([agent('Kiln', { live: false, lastSeen: ago(12) })], items, NOW);
    expect(gone[0]).toMatchObject({ silent: true, lapsed: null });
  });

  // P6-F1: an agent whose lease ran out is away, as the API says: «ausente» in every view.
  it('keeps an agent away on its expired lease, its item stuck', () => {
    const rows = agentRows([agent('Kiln', { live: false, lastSeen: ago(12) })], items, NOW);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Kiln',
        silent: true,
        quiet: true,
        state: 'silent',
        held: [{ id: 'CRE-44', title: 'Tortuga musgosa', look: 'stuck' }],
      }),
    ]);
    expect(agentCounts(rows)).toMatchObject({ silent: 0, away: 1 });
  });

  // An agent with no signal on a live lease keeps «sin señal», though it also left an item stuck
  // from an earlier lease: only the server's `away` status is «ausente».
  it('keeps «sin señal» for a silent agent that also left an item stuck', () => {
    const rows = agentRows(
      [agent('Kiln', { live: false, status: 'silent', holding: ['ERR-231'], lastSeen: ago(12) })],
      items,
      NOW,
    );
    expect(rows[0]).toMatchObject({ silent: true, quiet: false, state: 'silent' });
    expect(agentCounts(rows)).toMatchObject({ silent: 1, away: 0 });
    expect(pillSummary('live', rows)).toEqual({ kind: 'silent', count: 1 });
  });

  it('says an agent waits for your answer when its last handoff asks you something', () => {
    const [row] = agentRows([agent('Quill')], items, NOW, feed);
    expect(row).toMatchObject({ state: 'wait', item: { id: 'TAR-7' } });
  });

  it('leaves out an agent that is gone with nothing stuck', () => {
    expect(agentRows([agent('Old', { live: false })], items, NOW)).toEqual([]);
  });

  it('puts what asks for attention first: no signal, then working, then waiting, then idle', () => {
    const rows = agentRows(
      [
        agent('Idle', { lastSeen: ago(0) }),
        agent('Quill'),
        agent('Scout', { holding: ['ERR-231'] }),
        agent('Kiln', { live: false, lastSeen: ago(12) }),
      ],
      items,
      NOW,
      feed,
    );
    expect(rows.map((r) => r.name)).toEqual(['Kiln', 'Scout', 'Quill', 'Idle']);
    // The one with no signal is no listener: idle counts only those listening with nothing held.
    expect(agentCounts(rows)).toEqual({
      live: 3,
      holding: 1,
      idle: 2,
      connected: 0,
      silent: 0,
      away: 1,
      noProfile: 4,
    });
  });
});

describe('the agents pill', () => {
  const rows = (agents: Agent[]) => agentRows(agents, [], NOW);
  const opus = { harness: 'claude-code', model: 'opus', effort: 'high', family: 'opus' };
  const stuck = [
    item({ id: 'X', turn: 'agent', expiredLease: { holder: 'q', expiresAt: ago(12) } }),
  ];

  it('turns while an agent holds a lease, rests as a ring with agents, dashes with none', () => {
    expect(pillMark('live', rows([agent('a', { holding: ['X'] })]))).toBe('working');
    expect(pillMark('live', rows([agent('a')]))).toBe('idle');
    expect(pillMark('live', [])).toBe('none');
    expect(pillMark('reconnecting', rows([agent('a')]))).toBe('offline');
    // The first moments of a page load, before the stream says it is ready, are not offline
    // (P1-R2-8): the agents are counted as the server gave them.
    expect(pillMark('connecting', rows([agent('a')]))).toBe('idle');
  });

  it('says what happens, not how many: working first, the total in grey', () => {
    const a = (name: string, o: Partial<Agent> = {}) => agent(name, { profile: opus, ...o });
    expect(pillSummary('live', rows([a('a', { holding: ['X'] }), a('b'), a('c')]))).toEqual({
      kind: 'working',
      count: 1,
      extra: { kind: 'of', n: 3 },
    });
    expect(pillSummary('live', rows([a('a'), a('b')]))).toEqual({
      kind: 'waiting',
      count: 2,
      extra: null,
    });
  });

  it('lets an agent with no signal win over one without a profile, and that over the total', () => {
    const a = (name: string, o: Partial<Agent> = {}) => agent(name, { profile: opus, ...o });
    const quiet = agentRows(
      [a('a', { holding: ['W'] }), a('q', { live: false, lastSeen: ago(12) }), agent('n')],
      stuck,
      NOW,
    );
    expect(pillSummary('live', quiet)).toEqual({
      kind: 'working',
      count: 1,
      extra: { kind: 'away', n: 1 },
    });
    expect(pillSummary('live', rows([a('a'), agent('n', { profile: null })]))).toEqual({
      kind: 'waiting',
      count: 2,
      extra: { kind: 'noProfile', n: 1 },
    });
  });

  it('never counts an agent with no signal as listening: with only it, the pill says so, not «sin agentes»', () => {
    const quiet = agentRows([agent('q', { live: false, lastSeen: ago(12) })], stuck, NOW);
    expect(pillSummary('live', quiet)).toEqual({ kind: 'away', count: 1 });
    expect(pillMark('live', quiet)).toBe('none');
  });

  // One with no signal and one away at once: both show, within two data, and the profile datum
  // (or the total) is what gives way.
  it('shows both a silent and an away agent, dropping the profile datum first', () => {
    const held = item({ id: 'Y', turn: 'agent', lease: { holder: 's', expiresAt: inMinutes(9) } });
    const mixed = agentRows(
      [
        agent('a', { profile: opus }),
        agent('n', { profile: null }),
        agent('s', { live: false, status: 'silent', holding: ['Y'], lastSeen: ago(12) }),
        agent('q', { live: false, lastSeen: ago(12) }),
      ],
      [...stuck, held],
      NOW,
    );
    expect(pillSummary('live', mixed)).toEqual({
      kind: 'waiting',
      count: 2,
      extra: { kind: 'silentAway', n: 1, away: 1 },
    });
    // Nobody connected: the pill still names both.
    const alone = mixed.filter((r) => r.silent);
    expect(pillSummary('live', alone)).toEqual({ kind: 'silent', count: 1, away: 1 });
  });

  // The word for a live lease that gave no sign stays «sin señal»; only a lapsed lease is away.
  it('says «sin señal» of the server’s silent status and keeps it apart from away', () => {
    const held = item({ id: 'Y', turn: 'agent', lease: { holder: 's', expiresAt: inMinutes(9) } });
    const silent = agentRows(
      [agent('s', { live: false, status: 'silent', holding: ['Y'], lastSeen: ago(12) })],
      [held],
      NOW,
    );
    expect(pillSummary('live', silent)).toEqual({ kind: 'silent', count: 1 });
    expect(agentCounts(silent)).toMatchObject({ silent: 1, away: 0 });
  });

  // P7-R3-10: an agent no longer connected still holds a live lease on another item; it is quiet,
  // never «trabajando».
  it('never counts an agent gone quiet as working on what its lease still holds', () => {
    const held = item({ id: 'Y', turn: 'agent', lease: { holder: 'q', expiresAt: inMinutes(9) } });
    const quiet = agentRows(
      [agent('q', { live: false, lastSeen: ago(12), holding: ['Y'] })],
      [...stuck, held],
      NOW,
    );
    expect(quiet[0]).toMatchObject({ silent: true, working: false, state: 'silent' });
    expect(pillSummary('live', quiet)).toEqual({ kind: 'away', count: 1 });
    expect(pillMark('live', quiet)).toBe('none');
  });

  it('says "escuchando" only of an agent waiting in otea wait, never of one only connected', () => {
    const a = (name: string, o: Partial<Agent> = {}) => agent(name, { profile: opus, ...o });
    const idle = rows([a('a', { waiting: false }), a('b', { waiting: false })]);
    expect(pillSummary('live', idle)).toEqual({ kind: 'connected', count: 2, extra: null });
    expect(pillMark('live', idle)).toBe('idle');
    const mixed = rows([a('a', { waiting: true }), a('b', { waiting: false })]);
    expect(agentCounts(mixed)).toMatchObject({ idle: 1, connected: 1 });
    expect(pillSummary('live', mixed)).toEqual({ kind: 'waiting', count: 1, extra: null });
  });

  it('says nobody is connected, or that it cannot count while offline', () => {
    expect(pillSummary('live', [])).toEqual({ kind: 'none' });
    expect(pillSummary('reconnecting', rows([agent('a')]))).toEqual({ kind: 'offline' });
    expect(pillSummary('connecting', [])).toEqual({ kind: 'none' });
  });
});

// TS-29: on an offline cold start the stream still says connecting, and the pill counted the agents
// the cache kept («1 conectado») under the banner that says the computer does not answer.
describe('pillConnection', () => {
  it('is offline whenever the reads say the computer does not answer', () => {
    expect(pillConnection('connecting', true)).toBe('reconnecting');
    expect(pillConnection('live', true)).toBe('reconnecting');
    expect(pillConnection('connecting', false)).toBe('connecting');
    expect(pillConnection('live', false)).toBe('live');
  });
});
