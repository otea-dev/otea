// The one vocabulary for what an agent is doing now, worked out once by the server (listAgents) and
// sent as `status` with every agent of /api/agents. Every part of the desk (the pill, its menu, the
// item sheet, the reassign menu, the board's drafters) reads it from there and derives none of its
// own. The desk says it in Spanish (agent.status.* in the UI strings); the keys are the contract.
// The command line and MCP get it as the same field of that JSON (otea whoami picks names by its own
// rule, for names, and says no status).
//
//   working    holds an item it works on, on a live lease: nothing else makes it work
//   listening  waits in otea wait: what the person does on the desk reaches it
//   connected  heard (an MCP server open, a recent call) but not waiting: it hears nothing. An
//              agent that only called Otea (a profile, a next that took nothing, the command that
//              handed its work off) holds nothing: it is connected, between two items
//   silent     holds a live lease, gave no sign for a while, and nothing says its session ended
//   away       not connected
//
// An agent whose open question waits for the person (otea ask) is not working, whatever it holds:
// it waits for the answer, and reads as listening or connected like any agent between two steps.
// How long an agent counts as listening or connected after its last beat or otea command. The server
// works the statuses out by it; the desk grants a holder the same moment to pick up an answer.
export const LISTEN_WINDOW_MS = 150_000;

export const AGENT_STATUSES = ['working', 'listening', 'connected', 'silent', 'away'] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type StatusFacts = {
  live: boolean;
  // How many items it holds on a live lease.
  holding: number;
  waiting: boolean;
  // A question of its own waits for the person to answer.
  asking: boolean;
  sessionEnded: boolean;
};

export function agentStatus(f: StatusFacts): AgentStatus {
  if (!f.live) return f.holding > 0 && !f.sessionEnded ? 'silent' : 'away';
  const idle = f.waiting ? 'listening' : 'connected';
  if (f.asking) return idle;
  return f.holding > 0 ? 'working' : idle;
}

// Whether an item waits for an agent that nobody brings (the desk's «nadie está escuchando», and the
// notification that says it): on the agent turn, not set aside for later, no agent waiting in otea
// wait, and no agent at work on it (its live lease's holder is not working). The one rule the desk
// and the server share.
export function itemUnheard(f: {
  turn: string;
  setAside: boolean;
  anyoneWaits: boolean;
  holderWorking: boolean;
}): boolean {
  return f.turn === 'agent' && !f.setAside && !f.anyoneWaits && !f.holderWorking;
}
