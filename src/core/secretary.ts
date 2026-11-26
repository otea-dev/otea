// The secretary (0.8): the one agent per project that talks with the person and keeps the workers
// running, in the person's own harness session. It is an agent like any other (a name, a profile, a
// presence) with a role, declared once: `otea profile --role secretary`, or `otea connect --as <name>
// --role secretary`. The role never routes or restricts work on the boards.

export const AGENT_ROLES = ['secretary'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

// What the --role option says, in the help and in the MCP tools.
export const ROLE_ABOUT = 'secretary: the one agent per project that talks with the person';

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

// What wakes the secretary besides a board nobody listens to (`unheard`). The conversation (M2),
// the Bandeja (M5) and the escalated questions emit these through app/secretary.ts
// (emitSecretarySignal); `otea wait --secretary` returns each once.
//
//   person_message  the person posted a message in Hablar; `ref` is the message
//   bandeja_item    the person captured a rough note in the Bandeja; `ref` is the capture
//   escalation      an agent's question the secretary answers, not the person; `ref` is the item
export const SECRETARY_SIGNALS = ['person_message', 'bandeja_item', 'escalation'] as const;

export type SecretarySignalKind = (typeof SECRETARY_SIGNALS)[number];

export function isSecretarySignal(value: string): value is SecretarySignalKind {
  return (SECRETARY_SIGNALS as readonly string[]).includes(value);
}

// Every reason the secretary's wait returns: a signal, or board work nobody listens to.
export type SecretaryWakeKind = SecretarySignalKind | 'unheard';

// The secretary as the desk and the CLI tell it:
//   listening  waits in otea wait --secretary: what the person says reaches it now
//   connected  heard, but not waiting: it hears nothing until it waits again
//   offline    not connected; `since` is when it was last heard
// `pending`: signals emitted and not yet returned by a wait (what waits for it).
export type SecretaryState = 'listening' | 'connected' | 'offline';

export type SecretaryStatus = {
  name: string;
  state: SecretaryState;
  since: string | null;
  pending: number;
};
