// The one vocabulary every surface (desk, phone, CLI, MCP) uses for what an agent is doing now.
// The desk says it in Spanish (agent.status.* in the UI strings); the keys are the contract.
//
//   working    holds an item, or called Otea lately and did not just hand its work off
//   listening  waits in otea wait: what the person does on the desk reaches it
//   connected  heard (an MCP server open, a recent call) but not waiting: it hears nothing
//   silent     holds a live lease, gave no sign for a while, and nothing says its session ended
//   away       not connected
export const AGENT_STATUSES = ['working', 'listening', 'connected', 'silent', 'away'] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type StatusFacts = {
  live: boolean;
  holding: number;
  waiting: boolean;
  // It ran an otea command within the listening window.
  called: boolean;
  // Its last act was letting go of its work (a handoff or a release): it is between two items, not
  // at work, until it calls again later.
  handedOff: boolean;
  sessionEnded: boolean;
};

export function agentStatus(f: StatusFacts): AgentStatus {
  if (!f.live) return f.holding > 0 && !f.sessionEnded ? 'silent' : 'away';
  if (f.holding > 0) return 'working';
  if (f.called && !f.handedOff) return 'working';
  return f.waiting ? 'listening' : 'connected';
}
