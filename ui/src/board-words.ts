import type { BoardDefinition } from '../../src/core/board/model.ts';
import { BOARD_WORDS, type Lang, LEVEL_SAID } from '../../src/core/board/template-words.ts';
import { boardLang } from '../../src/core/board/templates.ts';
import { language } from './i18n/i18n.ts';

// The words the engine gives a board (Done, Dropped, yes and no, a level, an effort as a size), in
// the language the board was made in: the one its agent reads it in, whatever the screen's. The
// desk's chrome follows the screen; a board's words, these included, follow the board. With no
// board to ask (a list of other projects), the screen's language is all there is.
export type BoardSpeech = {
  lang: Lang;
  done: string;
  dropped: string;
  yes: string;
  no: string;
  inReview: string;
  // A level's word (low … critical), as a name: `Low`, `baja`.
  level: (value: string) => string;
  // A level playing the effort, said as a size (small … huge).
  size: (value: string) => string;
};

export const capital = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1);
export const lower = (word: string) => word.toLocaleLowerCase();

// The board Studio is editing, for the parts of its screens that are not handed a definition (a sample
// value, a form's chips): Studio edits one board at a time, and says so when it opens and leaves it.
let editing: Lang | undefined;

export function editingBoard(def: Pick<BoardDefinition, 'lang' | 'title'> | undefined): void {
  editing = def ? boardLang(def) : undefined;
}

export function boardSpeech(def?: Pick<BoardDefinition, 'lang' | 'title'>): BoardSpeech {
  const lang = def ? boardLang(def) : (editing ?? language());
  const words = BOARD_WORDS[lang];
  return {
    lang,
    done: words.done,
    dropped: words.dropped,
    yes: words.yes,
    no: words.no,
    inReview: words.inReview,
    level: (value) => LEVEL_SAID[lang][value] ?? value,
    size: (value) => words.size[value] ?? value,
  };
}
