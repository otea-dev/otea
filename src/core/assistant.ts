// The assistant (0.8): the one agent per project that talks with the person and keeps the workers
// running, in the person's own harness session. It is an agent like any other (a name, a profile, a
// presence) with a role, declared once: `otea profile --role assistant`, or `otea connect --as <name>
// --role assistant`. The role never routes or restricts work on the boards.

export const AGENT_ROLES = ['assistant'] as const;

// The role an agent has: the one it declares (the assistant), or the refiner, which Otea notes on
// its own for the agent that takes the Bandeja's notes in turn (`otea bandeja take --next`). Neither
// takes an item, so the desk never counts them as a worker (the queue says «ningún trabajador»).
export type AgentRole = (typeof AGENT_ROLES)[number] | 'refiner';

// What the --role option says, in the help and in the MCP tools.
export const ROLE_ABOUT = 'assistant: the one agent per project that talks with the person';

// A role an agent may declare (--role): the refiner's is never declared, Otea notes it.
export function isAgentRole(value: string): value is (typeof AGENT_ROLES)[number] {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

// What wakes the assistant besides a board nobody listens to (`unheard`). The conversation (M2),
// the Bandeja (M5) and the escalated questions emit these through app/assistant.ts
// (emitAssistantSignal); `otea wait --assistant` returns each once.
//
//   person_message  the person posted a message in Hablar; `ref` is the message
//   bandeja_item    the person captured a rough note in the Bandeja; `ref` is the capture
//   escalation      an agent's question the assistant answers, not the person; `ref` is the item
//   kind_changed    the person corrected what the assistant made of a turn (request or
//                   consultation); `ref` is the turn's first message
//   ready_for_review  an item reached the person's review (a first delivery, or a second round
//                   after a send-back); `ref` is the item
//   landed          an agent closed an item as Done (integrated); `ref` is the item. Returned in one
//                   wake for every landing since the assistant last acted (a stay away's worth)
export const ASSISTANT_SIGNALS = [
  'person_message',
  'bandeja_item',
  'escalation',
  'kind_changed',
  'ready_for_review',
  'landed',
] as const;

export type AssistantSignalKind = (typeof ASSISTANT_SIGNALS)[number];

export function isAssistantSignal(value: string): value is AssistantSignalKind {
  return (ASSISTANT_SIGNALS as readonly string[]).includes(value);
}

// Every reason the assistant's wait returns: a signal, or board work nobody listens to.
export type AssistantWakeKind = AssistantSignalKind | 'unheard';

// The assistant as the desk and the CLI tell it:
//   listening  waits in otea wait --assistant: what the person says reaches it now
//   connected  heard, but not waiting: it hears nothing until it waits again
//   offline    not connected; `since` is when it was last heard
// `pending`: signals emitted and not yet returned by a wait (what waits for it).
// `session`: the process of the harness session the assistant runs in (the one its declaration noted
// or its MCP server), while that session runs; the name alone proves nothing (S2).
export type AssistantState = 'listening' | 'connected' | 'offline';

export type AssistantStatus = {
  name: string;
  state: AssistantState;
  since: string | null;
  pending: number;
  session?: number;
};

// What waits for the assistant unattended, counted once (app/assistant-waiting.ts): the person's
// messages it has not read, the Bandeja's notes nobody took, and what agents escalated to it. `count`
// is their sum; the words say each part, so «2 messages» is never two of something else.
export type AssistantWaiting = {
  count: number;
  since: string | null;
  messages: number;
  notes: number;
  reports: number;
};

// The assistant as every surface shows it: one status and what waits for it, read from one call
// (GET /api/assistant, and the same object inside the conversation and the pending list).
export type AssistantView = AssistantStatus & { waiting: AssistantWaiting };
