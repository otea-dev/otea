import type { AgentStatus } from '../../../src/core/agent-status.ts';
import type { FeedEvent } from '../activity.ts';
import { isStuck } from '../derive/toca.ts';
import type { Connection } from '../hooks.ts';
import { t } from '../i18n/i18n.ts';
import { type Look, lookOf } from '../lanes/looks.ts';
import { isWorking } from '../listening.ts';
import {
  type Agent,
  type AgentProfile,
  hearsDesk,
  isConnected,
  liveAgents,
  statusOf,
} from '../presence.ts';
import { projectHref, waitingElsewhere, waitingIn, whereOf } from '../projects.ts';
import type { Item, ProjectOverview, ProjectView } from '../types.ts';
import { agentState } from '../views/toca/trace.ts';

// What the topbar's two menus list (SPEC §7.1, mock:3370-3393), worked out from the data alone.

export type ProjectRow = {
  id: string;
  name: string;
  current: boolean;
  // The mono line: what is going on there (what waits for you, the agents at work), or why it
  // cannot be read.
  line: string;
  // Where it lives, for the row's tooltip (the phone has none).
  where?: string;
  waiting: number;
  // Another served project opens at its own address; the current one and an unserved one have none.
  href?: string;
  inert: boolean;
};

// What is going on in a project, in a line: how many items wait for you, how many agents are at
// work and how many gave no sign. Each agent's state is the server's (status); none is worked out
// here. Nothing to say reads null.
export function stateLine(
  waiting: number,
  project: Pick<ProjectOverview, 'agents'>,
): string | null {
  const count = (status: AgentStatus) =>
    (project.agents ?? []).filter((each) => each.status === status).length;
  const working = count('working');
  const silent = count('silent');
  const away = count('away');
  const parts = [
    waiting > 0 ? t('shell.waitingThere', { count: waiting }) : null,
    working > 0 ? t('shell.pill.working', { count: working }) : null,
    silent > 0 ? t('shell.pill.silent', { count: silent }) : null,
    away > 0 ? t('shell.pill.away', { count: away }) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Every project on this machine: the one open now first (with your count, the rail's), then the
// rest as the server lists them. Before the server answers, the project open now alone.
export function projectRows(
  project: ProjectView,
  projects: readonly ProjectOverview[] | undefined,
  yoursHere: number,
  // On the phone a project's folder means nothing: its line says what waits there instead.
  phone = false,
  // The place of this project to open the others at, when it is one a project switch keeps
  // (Hablar: the conversation of the other project, not its Te toca).
  stay?: string,
): { rows: ProjectRow[]; total: number } {
  const listed: ProjectOverview[] = projects?.length
    ? [...projects.filter((p) => p.current), ...projects.filter((p) => !p.current)]
    : [
        {
          id: project.id,
          name: project.name,
          storage: 'common',
          current: true,
          paths: [],
          waiting: [],
          withAgents: 0,
          open: 0,
        },
      ];
  const rows = listed.map((each): ProjectRow => {
    if (each.current) {
      const told = stateLine(yoursHere, each);
      return {
        id: each.id,
        name: each.name,
        current: true,
        line: told ?? t('shell.projectOpen'),
        waiting: yoursHere,
        inert: false,
      };
    }
    const href = each.unavailable ? undefined : projectHref(each, stay);
    const where = whereOf(each) ?? '';
    // A folder that is gone is said with its path, in the line itself: a tooltip is nothing on the
    // phone. It outranks the rest of the state, which the badge's count still carries.
    const gone = each.paths.find((path) => path.missing)?.path;
    const waits = waitingIn(each);
    const state = href
      ? (stateLine(waits, each) ?? t('shell.nothingThere'))
      : t('shell.unavailable');
    return {
      id: each.id,
      name: each.name,
      current: false,
      line: gone !== undefined ? `${t('shell.pathMissing')} · ${gone}` : state,
      ...(where && !phone ? { where } : {}),
      waiting: waits,
      ...(href ? { href } : {}),
      inert: !href,
    };
  });
  return { rows, total: rows.reduce((sum, row) => sum + row.waiting, 0) };
}

// "3 más te esperan en 2 proyectos": the rest of your attention, outside this project. None while
// nothing waits elsewhere.
export function elsewhereLine(projects: readonly ProjectOverview[] | undefined): string | null {
  const { count, projects: where } = waitingElsewhere(projects ?? []);
  if (count === 0) return null;
  return t('shell.elsewhere', { count, where: t('shell.otherProjects', { count: where }) });
}

export type HeldItem = { id: string; title: string; look: Look };

// What an agent is up to, in the menu's order of attention: no signal (on a live lease, or on one
// that ran out and left its item stuck), working on what it holds, waiting for your answer, or idle.
export type AgentDoing = 'silent' | 'work' | 'wait' | 'idle';

const ATTENTION: readonly AgentDoing[] = ['silent', 'work', 'wait', 'idle'];

export type AgentRow = {
  name: string;
  harness: string | null;
  // What it declares it runs as (null before it declares one), whether it declared it in this
  // session, and when its model or effort last changed.
  profile: AgentProfile | null;
  confirmed: boolean;
  changedAt: string | null;
  // What it holds a lease on, then what it left stuck when its lease ran out.
  held: HeldItem[];
  // A lease of its ran out with nobody releasing it, and it is not connected: it left its item
  // stuck. Said as any agent with no signal.
  quiet: boolean;
  // It is connected, and the lease on an item of its ran out (the item is stuck): the agent may
  // still be at work on it, so it is no silence, and the row names the item instead of «libre».
  lapsed: { id: string; title: string; at: number } | null;
  // No signal: it holds a live lease and gave no sign for a while with nothing saying its session
  // ended, or its lease ran out on an item it left stuck: not connected, not at work («sin señal»).
  silent: boolean;
  // The server says it is at work (status working).
  working: boolean;
  // It waits in otea wait, so what you do here reaches it; connected only (its MCP server open, idle
  // in its chat) it hears nothing. An older server that does not say counts as waiting.
  waiting: boolean;
  // It asked for MCP (otea connect) and its harness never loaded Otea's server.
  mcpMissing: boolean;
  // Its harness loaded Otea's server, and it works through the command line (P6-R2-10).
  mcpUnused: boolean;
  state: AgentDoing;
  // Since when it is in that state, and the item it is about (none while idle with no past act).
  since: number;
  item: HeldItem | null;
  lastSeen: string;
};

// The harness an agent works through: its MCP client's name, else the one its profile names (a
// command-line agent names it there), else the command line.
export function harnessOf(a: Pick<Agent, 'harness' | 'profile'>): string | null {
  if (a.harness && a.harness.toLowerCase() !== 'cli') return a.harness;
  return a.profile?.harness || a.harness;
}

// The agents of the menu: the connected ones, then any agent gone quiet on an item it left stuck,
// so the menu says where the silence is; what asks for attention first (quiet, working, waiting
// for your answer, idle), the most recently seen first within each.
export function agentRows(
  agents: readonly Agent[],
  items: readonly Item[],
  now: number,
  feed: readonly FeedEvent[] = [],
): AgentRow[] {
  const stuckBy = (name: string) =>
    items.filter((it) => isStuck(it, now) && it.expiredLease?.holder === name);
  const live = liveAgents(agents);
  const byRecent = (list: readonly Agent[]) =>
    list.toSorted((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0));
  // Not connected, yet listed: one holding a live lease that gave no sign («sin señal»), and one
  // gone quiet on an item it left stuck, so the menu says where the silence is.
  const silent = byRecent(agents.filter((a) => statusOf(a) === 'silent'));
  const gone = byRecent(
    agents.filter((a) => !isConnected(a) && !silent.includes(a) && stuckBy(a.name).length > 0),
  );
  const rows = [...live, ...silent, ...gone].map((a): AgentRow => {
    const holding = a.holding.map((id): HeldItem => {
      const it = items.find((each) => each.id === id);
      return { id, title: it?.title ?? '', look: it ? lookOf(it, now) : 'working' };
    });
    const stuck = stuckBy(a.name).map(
      (it): HeldItem => ({ id: it.id, title: it.title, look: 'stuck' }),
    );
    const st = agentState(a.name, items, feed, now, a.lastSeen, statusOf(a));
    // Away (the server's status), and its lease ran out on an item it left stuck: «ausente». One
    // with no signal on a live lease keeps its own word, whatever else it left stuck, and one
    // still connected is whatever the server says it is: its lease on that item ran out, which
    // says nothing of the agent, and it may still be at work on it (lease-take.ts).
    const connected = live.includes(a);
    const quiet = statusOf(a) === 'away' && stuck.length > 0;
    const lapsedItem = connected ? stuck.at(0) : undefined;
    // An item whose question waits for you is not work: the agent waits for your answer. One
    // no longer connected works on nothing, whatever its lease still holds (P7-R3-10).
    const working = connected && isWorking(a);
    const isSilent = silent.includes(a) || quiet;
    const state: AgentDoing = working
      ? 'work'
      : isSilent
        ? 'silent'
        : st.state === 'wait'
          ? 'wait'
          : 'idle';
    return {
      name: a.name,
      harness: harnessOf(a),
      profile: a.profile ?? null,
      confirmed: a.profileConfirmed ?? false,
      changedAt: a.profileChangedAt ?? null,
      held: [...holding, ...stuck.filter((s) => !holding.some((h) => h.id === s.id))],
      quiet,
      lapsed: lapsedItem
        ? {
            id: lapsedItem.id,
            title: lapsedItem.title,
            at:
              Date.parse(
                items.find((it) => it.id === lapsedItem.id)?.expiredLease?.expiresAt ?? '',
              ) || now,
          }
        : null,
      silent: isSilent,
      working,
      waiting: hearsDesk(a),
      mcpMissing: a.mcp ? a.mcp === 'missing' : a.mcpMissing === true,
      mcpUnused: a.mcp === 'unused',
      state,
      since: st.since,
      item: st.item ? { id: st.item.id, title: st.item.title, look: lookOf(st.item, now) } : null,
      lastSeen: a.lastSeen,
    };
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        ATTENTION.indexOf(a.row.state) - ATTENTION.indexOf(b.row.state) || a.index - b.index,
    )
    .map(({ row }) => row);
}

// The agents the menu lists, those holding a lease ("trabajando"), those waiting in otea wait with
// nothing held ("escuchando": never one with no signal, which no longer listens), those connected
// but not waiting (an MCP server open, the agent idle in its chat: it hears nothing), those with no
// signal and those with no profile: counted from the menu's own rows, so the pill and the menu
// agree. The words are the server's status words, and no others.
export function agentCounts(rows: readonly AgentRow[]): {
  live: number;
  holding: number;
  idle: number;
  connected: number;
  silent: number;
  // Gone (not connected) with its lease run out on an item it left stuck: «ausente», never a
  // signal that stopped.
  away: number;
  noProfile: number;
} {
  const holding = rows.filter((a) => a.working).length;
  const free = rows.filter((a) => !a.working && !a.silent);
  return {
    live: rows.filter((a) => !a.silent).length,
    holding,
    idle: free.filter((a) => a.waiting).length,
    connected: free.filter((a) => !a.waiting).length,
    silent: rows.filter((a) => a.silent && !a.quiet).length,
    away: rows.filter((a) => a.quiet).length,
    noProfile: rows.filter((a) => !a.profile).length,
  };
}

export type PillMark = 'working' | 'idle' | 'none' | 'offline';

// The connection the pill goes by: offline as well whenever the reads say the computer does not
// answer (the offline banner shows), even while the stream still tries to open (TS-29).
export function pillConnection(connection: Connection, offline: boolean): Connection {
  return offline ? 'reconnecting' : connection;
}

// The pill's 16 px mark: the working node with its orbit while an agent holds a lease, a ring with
// agents connected, a dashed ring with none (one gone quiet is not connected); offline while the
// stream is down (it cannot count). The first moments of a page load, before the stream is ready,
// are not offline: they count what the server gave (P1-R2-8).
export function pillMark(connection: Connection, rows: readonly AgentRow[]): PillMark {
  if (connection === 'reconnecting') return 'offline';
  const { holding, idle, connected } = agentCounts(rows);
  if (holding > 0) return 'working';
  return idle + connected > 0 ? 'idle' : 'none';
}

// The pill's second datum, in grey or in warn: one with no signal wins over one without a profile,
// which wins over the total ("de 3") beside those working. Never more than two data on the pill.
export type PillExtra =
  | { kind: 'silent' | 'away' | 'noProfile' | 'of'; n: number }
  // One with no signal and one away: both show, and nothing else (two data at most).
  | { kind: 'silentAway'; n: number; away: number }
  | null;

export type PillSummary =
  | { kind: 'offline' }
  | { kind: 'none' }
  // Nobody connected, but an agent gave no signal (on a live lease) or is away (its lease ran out
  // and left its item stuck): not an empty room, and not at work either.
  | { kind: 'silent'; count: number; away?: number }
  | { kind: 'away'; count: number }
  | { kind: 'working' | 'waiting' | 'connected'; count: number; extra: PillExtra };

// What the pill says (mock §1): what happens, not how many there are. "2 trabajando" before "3
// agentes"; with nobody working, how many wait; nobody connected; or that it cannot tell.
export function pillSummary(connection: Connection, rows: readonly AgentRow[]): PillSummary {
  if (connection === 'reconnecting') return { kind: 'offline' };
  const c = agentCounts(rows);
  if (c.live === 0) {
    if (c.silent > 0) {
      return { kind: 'silent', count: c.silent, ...(c.away > 0 ? { away: c.away } : {}) };
    }
    return c.away > 0 ? { kind: 'away', count: c.away } : { kind: 'none' };
  }
  const working = c.holding > 0;
  const extra: PillExtra =
    c.silent > 0 && c.away > 0
      ? { kind: 'silentAway', n: c.silent, away: c.away }
      : c.silent > 0
        ? { kind: 'silent', n: c.silent }
        : c.away > 0
          ? { kind: 'away', n: c.away }
          : c.noProfile > 0
            ? { kind: 'noProfile', n: c.noProfile }
            : working && c.live > c.holding
              ? { kind: 'of', n: c.live }
              : null;
  if (working) return { kind: 'working', count: c.holding, extra };
  // Connected but none waiting: nobody hears the desk, and the pill does not say "escuchando".
  return c.idle > 0
    ? { kind: 'waiting', count: c.idle, extra }
    : { kind: 'connected', count: c.connected, extra };
}
