import type { DatabaseSync } from 'node:sqlite';
import { parseDefinition } from '../core/board/schema.ts';
import { LANGS, type Lang } from '../core/board/template-words.ts';
import { boardLang } from '../core/board/templates.ts';
import { findVersion, listBoards } from '../store/boards.ts';
import { selectProjectLang, updateProjectLang } from '../store/queries.ts';
import { relanguageBoards } from './board-relanguage.ts';
import { defaultLang } from './language.ts';
import type { Env, Project } from './project.ts';

// The project's language: what Otea makes for the project with no desk to ask (otea start, otea
// prompt, otea board add and board draft, a Pedido's title) is in it, so two runs of the same
// command say the same thing whatever language the desk was last in or this shell's locale says.
// The desk keeps its own language for its screen, and a board made on the desk is in the screen's.
//   1. It is stored on the project when the project is created: the language the person used then
//      (app/language.ts), or the one --lang named.
//   2. A project from before has none stored: it takes the language of its Pedidos board, which was
//      made in the language in use at the time, and keeps it from then on.
//   3. Failing both, today's rule (the desk's last language, the computer's, English).
// `otea projects lang` changes it, and the boards that exist follow (board-relanguage.ts).

const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

// The language the project's own Pedidos board was made in, when the project has one.
function requestsBoardLang(db: DatabaseSync): Lang | undefined {
  const board = listBoards(db).find((row) => row.builtin);
  const version =
    board?.liveVersion == null ? undefined : findVersion(db, board.id, board.liveVersion);
  if (version === undefined) return undefined;
  // A definition that cannot be read says nothing: it must not stop the project from opening.
  try {
    const reading = parseDefinition(JSON.parse(version.definition));
    return reading.ok ? boardLang(reading.definition) : undefined;
  } catch {
    return undefined;
  }
}

// What is stored, read without writing.
export function storedProjectLang(db: DatabaseSync): Lang | undefined {
  const value = selectProjectLang(db);
  return isLang(value) ? value : undefined;
}

// Settles the language of a project that has none yet, once: `creation` is the one a new project is
// made in; an older project takes its Pedidos board's; else today's rule.
export function settleProjectLang(db: DatabaseSync, env: Env, creation?: Lang): Lang {
  const stored = storedProjectLang(db);
  if (stored !== undefined) return stored;
  const lang = creation ?? requestsBoardLang(db) ?? defaultLang(env);
  updateProjectLang(db, lang, true);
  return storedProjectLang(db) ?? lang;
}

// The language of what Otea makes for this project from now on.
export function projectLanguage(project: Pick<Project, 'db'>, env: Env = process.env): Lang {
  return storedProjectLang(project.db) ?? settleProjectLang(project.db, env);
}

// Changes it; what exists keeps the words it was made in.
export function setProjectLanguage(project: Pick<Project, 'db'>, lang: Lang): Lang {
  updateProjectLang(project.db, lang);
  return lang;
}

// The person says the project is in `lang`: the project takes it, and the boards that exist follow
// (board-relanguage.ts), so an English project is English in every word Otea writes for it, the
// boards a template made included.
export function sayProjectLanguage(project: Project, lang: Lang): Lang {
  setProjectLanguage(project, lang);
  relanguageBoards(project, lang);
  return lang;
}
