import type { AgentPromptView } from '../api.ts';

// Conectar un agente says two things in two registers. What the person reads is plain: what the
// agent will do, and where (connect.*, next.* and the first-contact words of the empty project and
// of Te toca). What an agent needs (the commands, the tools it talks to Otea through) stays behind
// «Detalles técnicos» (connect.tech.*). connect-words.test.ts keeps the first register free of
// both, in every language, reading the catalogs by those prefixes.

// `code`: the project is a git repository, the fact the pasted prompt is written from too.

// The lede for the project's moment: the first contact (written for a repository, or for a folder
// of files), the first agent of a project with boards, or one more agent joining.
export function ledeKey(view: Pick<AgentPromptView, 'kind' | 'first' | 'code'> | null) {
  if (view?.kind === 'join') return view.first === true ? 'connect.ledeFirst' : 'connect.ledeJoin';
  return view?.code === false ? 'connect.ledeStartFiles' : 'connect.ledeStartCode';
}

// Where the agent works, for an agent that joins: its own copy of the project (a repository gets
// a worktree, as the prompt says), or the shared folder. The first agent of a folder has nobody
// beside it to say it of.
export function whereKey(view: Pick<AgentPromptView, 'kind' | 'first' | 'code'> | null) {
  if (view?.kind !== 'join') return undefined;
  if (view.code === true) return 'connect.whereCode' as const;
  return view.first === true ? undefined : ('connect.whereFiles' as const);
}
