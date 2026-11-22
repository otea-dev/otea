// The one vocabulary for what an agent is doing now, worked out once by the server (listAgents) and
// sent as `status` with every agent of /api/agents. Every part of the desk (the pill, its menu, the
// item sheet, the reassign menu, the board's drafters) reads it from there and derives none of its
// own. The desk says it in Spanish (agent.status.* in the UI strings); the keys are the contract.
// The command line and MCP get it as the same field of that JSON (otea whoami picks names by its own
// rule, for names, and says no status).
//
//   working    holds an item it works on, or called Otea lately and did not just hand its work off
//   listening  waits in otea wait: what the person does on the desk reaches it
//   connected  heard (an MCP server open, a recent call) but not waiting: it hears nothing
//   silent     holds a live lease, gave no sign for a while, and nothing says its session ended
//   away       not connected
//
// An agent whose open question waits for the person (otea ask) is not working, whatever it holds:
// it waits for the answer, and reads as listening or connected like any agent between two steps.
export const AGENT_STATUSES = ['working', 'listening', 'connected', 'silent', 'away'] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type StatusFacts = {
  live: boolean;
  // How many items it holds on a live lease.
  holding: number;
  waiting: boolean;
  // It ran an otea command within the listening window.
  called: boolean;
  // Its last act was letting go of its work (a handoff or a release): it is between two items, not
  // at work, until it calls again later. A call in the same millisecond as the release is part of
  // it: the tie counts as handed off.
  handedOff: boolean;
  // A question of its own waits for the person to answer.
  asking: boolean;
  sessionEnded: boolean;
};

export function agentStatus(f: StatusFacts): AgentStatus {
  if (!f.live) return f.holding > 0 && !f.sessionEnded ? 'silent' : 'away';
  const idle = f.waiting ? 'listening' : 'connected';
  if (f.asking) return idle;
  if (f.holding > 0) return 'working';
  if (f.called && !f.handedOff) return 'working';
  return idle;
}
