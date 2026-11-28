import { NO_BOARDS } from '../app/init-boards.ts';
import type { Lang } from '../core/board/templates.ts';
import { CommandFailure } from './command.ts';

// otea start's first board: what a person is shown, at a terminal or in the report, to pick one
// without knowing the catalogue (P2-F8). Two templates cover a first session, and the third way is
// no board at all: the agent designs them with the person.

type Pick = { key: string; line: string };

export const CODE_BOARD: Pick = {
  key: 'changes',
  line: 'code: your agent does each change on its own branch, and it merges once you approve',
};
export const TODO_BOARD: Pick = {
  key: 'todos',
  line: 'anything that is not code: a to-do list your agent works through',
};
const AGENT_LINE = 'no board now: your agent designs the boards with you';

const KEY_WIDTH = Math.max(CODE_BOARD.key.length, TODO_BOARD.key.length, 'agent'.length);

// What a code repo most likely wants; a plain folder wants to-dos.
export function defaultBoard(inGitRepo: boolean): Pick {
  return inGitRepo ? CODE_BOARD : TODO_BOARD;
}

// The question the person answers: every way out is on the screen before Enter means anything.
export function choiceQuestion(fallback: Pick): string {
  const mark = (pick: Pick) => (pick.key === fallback.key ? '  (default)' : '');
  const row = (n: number, key: string, line: string) => `  ${n}) ${key.padEnd(KEY_WIDTH)}  ${line}`;
  return [
    'A first board? Nothing is made until you choose.',
    `${row(1, CODE_BOARD.key, CODE_BOARD.line)}${mark(CODE_BOARD)}`,
    `${row(2, TODO_BOARD.key, TODO_BOARD.line)}${mark(TODO_BOARD)}`,
    row(3, 'agent', AGENT_LINE),
    `Type 1-3, a template key (otea start --help lists them all) or "none" for no board. Enter takes ${fallback.key}: `,
  ].join('\n');
}

// The template key the answer names: the default on Enter, none (NO_BOARDS) for no board, or what
// was typed, left for the template check to refuse when it is no template.
export function choiceFrom(answer: string | undefined, fallback: Pick): string {
  const said = (answer ?? '').trim().toLowerCase();
  if (said === '') return fallback.key;
  if (said === '1') return CODE_BOARD.key;
  if (said === '2') return TODO_BOARD.key;
  if (said === '3' || said === 'agent' || said === 'none' || said === 'n' || said === '0') {
    return NO_BOARDS;
  }
  return said;
}

// Ctrl+C at a question: the command stops before it changes anything, and says so.
export function cancelled(
  error: unknown,
  message = 'Cancelled: nothing was made',
): CommandFailure | undefined {
  return error instanceof Error && error.name === 'AbortError'
    ? new CommandFailure('interrupted', message)
    : undefined;
}

// The first thing otea start says, in the project's language and before any board text: the three
// steps to an assistant, the way to daily use. `signIn` is a run with --no-open, where the link to
// the desk is the one printed below and the desk is not open yet.
export function firstRunLines(lang: Lang, where: { url: string; signIn: boolean }): string[] {
  if (lang === 'es') {
    return [
      'Para empezar (1 minuto):',
      where.signIn
        ? '  1. Abre el escritorio con el enlace de inicio de sesión de más abajo.'
        : `  1. Abre el escritorio en tu navegador (si no se abrió solo): ${where.url}`,
      '  2. Entra en Hablar y copia el texto del asistente (o, en la terminal: otea prompt --role assistant).',
      '  3. Pégalo en una sesión nueva de tu agente. La primera respuesta tarda 1-2 minutos.',
    ];
  }
  return [
    'To start (1 minute):',
    where.signIn
      ? '  1. Open the desk with the sign-in link below.'
      : `  1. Open the desk in your browser (if it did not open by itself): ${where.url}`,
    "  2. Go to Talk and copy the assistant's text (or, in a terminal: otea prompt --role assistant).",
    '  3. Paste it into a new session of your agent. The first reply takes 1-2 minutes.',
  ];
}

// The report's lines when no board was made and no one could be asked: the exact commands, each
// with what its board is for, and the agent's way.
export function boardHintLines(): string[] {
  const command = (pick: Pick) =>
    `  otea start --template ${pick.key.padEnd(KEY_WIDTH)}  ${pick.line}`;
  return [
    'Boards: none yet (nothing is made until you choose). In a code repo run the first; for anything else, the second:',
    command(CODE_BOARD),
    command(TODO_BOARD),
    '  or paste the text below and your agent designs the boards with you (otea start --help lists every template)',
  ];
}
