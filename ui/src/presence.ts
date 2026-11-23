import { AGENT_STATUSES, type AgentStatus } from '../../src/core/agent-status.ts';
import { t } from './i18n/i18n.ts';
import type { ItemEvent } from './types.ts';

// An agent the server has seen in this project: its name (the actor of its claims, leases and
// writes), the harness its MCP client named (none when it only used the CLI), the items it holds a
// lease on, when it last gave a sign, and whether it still counts as connected.
export type Agent = {
  name: string;
  harness: string | null;
  holding: string[];
  lastSeen: string;
  live: boolean;
  // What an older server leaves out: the harness's version, when the agent connected, and the
  // profile it declares (null before it declares one), whether it declared it in this session and
  // when its model or effort last changed.
  harnessVersion?: string | null;
  connectedAt?: string | null;
  profile?: AgentProfile | null;
  profileConfirmed?: boolean;
  profileChangedAt?: string | null;
  // Its open MCP server or a running otea wait heard it lately (`listening`); a running otea wait
  // did (`waiting`): only then does what the person does here reach it. Absent from an older server.
  listening?: boolean;
  waiting?: boolean;
  // It asked to connect over MCP (otea connect) and was never heard through Otea's MCP server: its
  // harness declined the server, or it was never added. Absent from an older server.
  mcpMissing?: boolean;
  // MCP as the server tells it: missing (asked, never loaded by its harness), or unused (loaded,
  // and this agent works through the command line). Absent from an older server.
  mcp?: 'missing' | 'unused' | null;
  // When it last ran an otea command (null if never; a listener's beat is none), and whether every
  // process it was heard listening through has ended: Otea knows its session ended. Absent from an
  // older server.
  actedAt?: string | null;
  sessionEnded?: boolean;
  // What it is doing now, as the server words it for every surface (src/core/agent-status.ts).
  // Absent from an older server.
  status?: AgentStatus;
};

// What an agent declares it runs as, as declared, with the family its model groups under.
export type AgentProfile = { harness: string; model: string; effort: string; family: string };

// A profile as the server gives it, or null when it is not one.
export function parseProfile(raw: unknown): AgentProfile | null {
  const p = raw as Partial<AgentProfile> | null;
  if (typeof p?.model !== 'string' || typeof p.effort !== 'string') return null;
  return {
    harness: typeof p.harness === 'string' ? p.harness : '',
    model: p.model,
    effort: p.effort,
    family: typeof p.family === 'string' ? p.family : p.model,
  };
}

const textOr = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// The profile an agent acted with: the one it handed the work off under when the server says
// (`delivered`, a closed item's doer, P3C-R2-5), else the one its last own event among these kept
// (each event keeps the profile of that moment), else the one it declares now; null when none says.
export function actedWith(
  agent: string,
  events: readonly Pick<ItemEvent, 'actor' | 'data' | 'profile'>[],
  agents?: readonly Agent[] | null,
  delivered?: AgentProfile | null,
): AgentProfile | null {
  if (delivered) return delivered;
  const own = events.findLast(
    (e) =>
      e.actor.kind === 'agent' &&
      e.actor.name === agent &&
      typeof e.data.via !== 'string' &&
      e.profile !== undefined,
  );
  return own?.profile ?? agents?.find((a) => a.name === agent)?.profile ?? null;
}

// What the agent is doing now: the one word the server says (src/core/agent-status.ts), which no
// part of the desk works out for itself. A server that sends none (older) leaves only its flags.
export function statusOf(a: Pick<Agent, 'status' | 'live' | 'holding' | 'waiting'>): AgentStatus {
  if (a.status !== undefined) return a.status;
  if (!a.live) return 'away';
  if (a.holding.length > 0) return 'working';
  return a.waiting === true ? 'listening' : 'connected';
}

// The word for what the agent is doing now, in the language on screen: the server's status through
// agent.status.*, the one set of words (working, listening, connected, silent, away).
export function statusWord(a: Pick<Agent, 'status' | 'live' | 'holding' | 'waiting'>): string {
  return t(`agent.status.${statusOf(a)}`);
}

// Whether the agent hears what the person does on the desk: it waits in otea wait (status
// listening). A server that sends no status leaves the flag; one that says nothing of it, as yes.
export function hearsDesk(a: Pick<Agent, 'status' | 'live' | 'holding' | 'waiting'>): boolean {
  return a.status !== undefined ? a.status === 'listening' : a.waiting !== false;
}

// Connected: working, listening or connected. One silent on a live lease is not (it is in the menu,
// said «sin señal»), and neither is one away.
export function isConnected(a: Pick<Agent, 'status' | 'live' | 'holding' | 'waiting'>): boolean {
  const status = statusOf(a);
  return status !== 'away' && status !== 'silent';
}

// The connected agents, the most recently seen first; a name keeps its place on a tie.
export function liveAgents(agents: readonly Agent[]): Agent[] {
  return agents
    .filter(isConnected)
    .map((agent, index) => ({ agent, index, seen: Date.parse(agent.lastSeen) || 0 }))
    .sort((a, b) => b.seen - a.seen || a.index - b.index)
    .map(({ agent }) => agent);
}

// The server's answer, read defensively: a malformed agent is left out rather than breaking the bar.
export function parseAgents(body: unknown): Agent[] {
  const list = (body as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): Agent[] => {
    const each = raw as Partial<Agent> | null;
    if (typeof each?.name !== 'string' || typeof each.lastSeen !== 'string') return [];
    return [
      {
        name: each.name,
        harness: typeof each.harness === 'string' ? each.harness : null,
        holding: Array.isArray(each.holding)
          ? each.holding.filter((id): id is string => typeof id === 'string')
          : [],
        lastSeen: each.lastSeen,
        live: each.live !== false,
        ...('harnessVersion' in each ? { harnessVersion: textOr(each.harnessVersion) } : {}),
        ...('connectedAt' in each ? { connectedAt: textOr(each.connectedAt) } : {}),
        ...('profile' in each ? { profile: parseProfile(each.profile) } : {}),
        ...('profileConfirmed' in each ? { profileConfirmed: each.profileConfirmed === true } : {}),
        ...('profileChangedAt' in each ? { profileChangedAt: textOr(each.profileChangedAt) } : {}),
        ...('listening' in each ? { listening: each.listening === true } : {}),
        ...('waiting' in each ? { waiting: each.waiting === true } : {}),
        ...('mcpMissing' in each ? { mcpMissing: each.mcpMissing === true } : {}),
        ...('mcp' in each
          ? { mcp: each.mcp === 'missing' || each.mcp === 'unused' ? each.mcp : null }
          : {}),
        ...('actedAt' in each ? { actedAt: textOr(each.actedAt) } : {}),
        ...('sessionEnded' in each ? { sessionEnded: each.sessionEnded === true } : {}),
        ...(AGENT_STATUSES.includes(each.status as AgentStatus)
          ? { status: each.status as AgentStatus }
          : {}),
      },
    ];
  });
}

// How often the pill asks again between changes: a connection or a lease can lapse without a write.
export const PRESENCE_POLL_MS = 10_000;
