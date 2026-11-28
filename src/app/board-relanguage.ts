import { speak } from '../core/board/localize.ts';
import { type BoardDefinition, clone } from '../core/board/model.ts';
import { boardLang, type Lang, requestsBoard, TEMPLATES } from '../core/board/templates.ts';
import { listBoards } from '../store/boards.ts';
import { getBoardRecord, publishBoard, saveDraft } from './boards.ts';
import type { Context } from './context.ts';
import { type Clock, systemClock } from './items.ts';

// The person says the project is in another language: the boards that exist follow, as a new
// version of each, so what Otea writes about them (a handoff note, a caption, the text its agents
// get) and what the desk shows of them is in that language. A word a template gave a board moves
// to its words in the new language (the board keeps them all, localize.ts); a word the person wrote
// stays as they wrote it; a board still called what its template calls it takes the new name, and
// one with another name keeps it. A board with a draft open is left alone: someone is editing it.

// What a board is called by its template or by Otea, in each language: the names a board takes
// when it follows the project's language.
function nameIn(def: BoardDefinition, from: Lang, to: Lang): string {
  const named = def.template ? TEMPLATES.find(({ key }) => key === def.template)?.board : undefined;
  if (named !== undefined && named[from] === def.name) return named[to];
  if (requestsBoard(from).name === def.name) return requestsBoard(to).name;
  return def.name;
}

// Moves each standing board that is in another language to `lang`; returns the names it moved.
export function relanguageBoards(
  ctx: Context,
  lang: Lang,
  now: Clock = systemClock,
): { moved: string[]; kept: string[] } {
  const moved: string[] = [];
  const kept: string[] = [];
  for (const row of listBoards(ctx.db)) {
    if (row.liveVersion === null || row.archivedAt !== null) continue;
    const record = getBoardRecord(ctx, row.id);
    const live = record.live?.definition;
    if (!live || boardLang(live) === lang) continue;
    const label = live.name;
    if (record.draft) {
      kept.push(label);
      continue;
    }
    const from = boardLang(live);
    const definition = clone(speak(live, lang));
    definition.lang = lang;
    const taken = new Set(listBoards(ctx.db).map(({ collection }) => collection));
    const name = nameIn(live, from, lang);
    if (name !== live.name && !taken.has(name)) definition.name = name;
    try {
      saveDraft(ctx, row.id, { definition, baseVersion: row.liveVersion }, now);
      publishBoard(ctx, row.id, { moves: {}, by: { kind: 'human', name: 'otea' } }, now);
      moved.push(label);
    } catch {
      // A board that cannot be republished as it is keeps its words, and loses nothing: it is
      // reported, and the person can read it the way it was made.
      kept.push(label);
    }
  }
  return { moved, kept };
}
