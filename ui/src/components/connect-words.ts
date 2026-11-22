import type { AgentPromptView } from '../api.ts';
import type { MessageKey } from '../i18n/i18n.ts';

// Conectar un agente says two things in two registers. What the person reads is plain: what the
// agent will do, and where. What an agent needs (the commands, the tools it talks to Otea through)
// stays behind «Detalles técnicos». PLAIN_CONNECT_KEYS is the first register, whole: no message of
// it names a command or a tool, in any language (connect-words.test.ts keeps it so).
export const PLAIN_CONNECT_KEYS = [
  'connect.title',
  'connect.ledeStartCode',
  'connect.ledeStartFiles',
  'connect.ledeFirst',
  'connect.ledeJoin',
  'connect.whereCode',
  'connect.whereFiles',
  'connect.boards',
  'connect.forAgent',
  'connect.copyPrompt',
  'connect.copiedPrompt',
  'connect.appears',
  'connect.done',
  'emptyProject.title',
  'emptyProject.text',
  'emptyProject.noBoards',
  'emptyProject.orPick',
  'emptyProject.pickBoards',
  'toca.noAgents.title',
  'toca.noAgents.waiting',
  'toca.noAgents.nothing',
] as const satisfies readonly MessageKey[];

// The lede for the project's moment: the first contact (written for code, or for a folder of
// files), the first agent of a project with boards, or one more agent joining.
export function ledeKey(view: Pick<AgentPromptView, 'kind' | 'first' | 'code'> | null) {
  if (view?.kind === 'join') return view.first === true ? 'connect.ledeFirst' : 'connect.ledeJoin';
  return view?.code === false ? 'connect.ledeStartFiles' : 'connect.ledeStartCode';
}

// Where the agent works, for an agent that joins: its own copy of the code, or the shared folder.
// The first agent of a folder has nobody beside it to say it of.
export function whereKey(view: Pick<AgentPromptView, 'kind' | 'first' | 'code'> | null) {
  if (view?.kind !== 'join') return undefined;
  if (view.code === true) return 'connect.whereCode' as const;
  return view.first === true ? undefined : ('connect.whereFiles' as const);
}
