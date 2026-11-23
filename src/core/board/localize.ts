import { type BoardDefinition, clone, type Said, type Snapshot } from './model.ts';
import { LANGS, type Lang } from './template-words.ts';

// A board says its words in every language Otea speaks. When a template makes a board, each word
// the template gave it (a name, a hint, an instruction) is kept on the board in all those languages,
// in `snapshot`; the board never looks at the template again, so a later release that edits or
// removes a template touches no board that exists. The desk and the agent both read a board in the
// language it was made in (`lang`), whatever the desk's screen is in; the snapshot keeps the other
// language's words for a board read in it, and a word in no snapshot is the one text its person
// wrote, the same in every language. When a person changes a word that has a
// snapshot, the snapshot of that word goes and their text stands (reconcile). Pure and
// browser-safe.

type Text = string | readonly string[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// What `path` holds on a board: undefined when the board has nothing there.
function read(def: BoardDefinition, path: string): Text | undefined {
  const [head, id, field, option] = path.split('.');
  switch (head) {
    case 'title':
    case 'item':
    case 'about':
    case 'idle':
    case 'samples':
      return def[head];
    case 'parts': {
      const part = def.parts[id ?? ''];
      if (!part) return undefined;
      if (field === 'options') return part.options.find((choice) => choice.id === option)?.name;
      return field === 'name' || field === 'hint' ? part[field] : undefined;
    }
    case 'steps': {
      const step = def.steps.find((candidate) => candidate.id === id);
      if (!step) return undefined;
      if (field === 'name') return step.name;
      if (field === 'note') return step.note.hint;
      return field === 'take' || field === 'before' || field === 'review'
        ? step.instructions[field]
        : undefined;
    }
    case 'motives':
      return def.drop.motives.find((motive) => motive.id === id)?.name;
    default:
      return undefined;
  }
}

function write(def: BoardDefinition, path: string, value: Text): void {
  const [head, id, field, option] = path.split('.');
  const text = typeof value === 'string' ? value : '';
  switch (head) {
    case 'title':
    case 'item':
    case 'about':
    case 'idle':
      def[head] = text;
      return;
    case 'samples':
      if (typeof value !== 'string') def.samples = [...value];
      return;
    case 'parts': {
      const part = def.parts[id ?? ''];
      if (!part) return;
      const choice = part.options.find((candidate) => candidate.id === option);
      if (field === 'options' && choice) choice.name = text;
      else if (field === 'name' || field === 'hint') part[field] = text;
      return;
    }
    case 'steps': {
      const step = def.steps.find((candidate) => candidate.id === id);
      if (!step) return;
      if (field === 'name') step.name = text;
      else if (field === 'note') step.note.hint = text;
      else if (field === 'take' || field === 'before' || field === 'review')
        step.instructions[field] = text;
      return;
    }
    case 'motives': {
      const motive = def.drop.motives.find((candidate) => candidate.id === id);
      if (motive) motive.name = text;
      return;
    }
  }
}

// Every word of a board a template can give, by path.
export function wordsOf(def: BoardDefinition): Map<string, Text> {
  const words = new Map<string, Text>();
  const add = (path: string) => {
    const value = read(def, path);
    if (value !== undefined) words.set(path, value);
  };
  for (const path of ['title', 'item', 'about', 'idle', 'samples']) add(path);
  for (const part of Object.values(def.parts)) {
    add(`parts.${part.id}.name`);
    add(`parts.${part.id}.hint`);
    for (const choice of part.options) add(`parts.${part.id}.options.${choice.id}`);
  }
  for (const step of def.steps) {
    for (const field of ['name', 'take', 'before', 'review', 'note'])
      add(`steps.${step.id}.${field}`);
  }
  for (const motive of def.drop.motives) add(`motives.${motive.id}`);
  return words;
}

// The snapshot of a board made in every language: the same board, one copy per language, with the
// same ids. A word that reads the same in every language needs none.
export function snapshotOf(made: Readonly<Partial<Record<Lang, BoardDefinition>>>): Snapshot {
  const perLang = LANGS.flatMap((lang) => {
    const def = made[lang];
    return def ? [[lang, wordsOf(def)] as const] : [];
  });
  const [first] = perLang;
  const snapshot: Record<string, Said> = {};
  for (const path of first?.[1].keys() ?? []) {
    const said = Object.fromEntries(
      perLang.flatMap(([lang, words]) => {
        const text = words.get(path);
        return text === undefined ? [] : [[lang, text] as const];
      }),
    );
    if (new Set(Object.values(said).map((text) => JSON.stringify(text))).size > 1)
      snapshot[path] = said;
  }
  return snapshot;
}

// The text of a word in `lang`: its own, else the language the board was made in, else any.
function pick(said: Said, lang: string, madeIn: string | undefined): Text | undefined {
  return said[lang] ?? (madeIn === undefined ? undefined : said[madeIn]) ?? Object.values(said)[0];
}

// A board read in a language: every word that has a snapshot is said in `lang`, else in the
// language the board was made in. A word the person wrote has no snapshot and stays as it is.
export function speak(def: BoardDefinition, lang: string | undefined): BoardDefinition {
  if (!def.snapshot) return def;
  const said = clone(def);
  for (const [path, words] of Object.entries(def.snapshot)) {
    const text = pick(words, lang ?? def.lang ?? 'en', def.lang);
    if (text !== undefined && read(said, path) !== undefined) write(said, path, text);
  }
  return said;
}

// A board as it is about to be stored, which was read in `reading` and may have been edited since:
// a word whose text is no longer the snapshot's in that language was changed by the person, so its
// snapshot goes and what they wrote stands, in every language. A snapshot of a word the board no
// longer has goes too.
export function reconcile(def: BoardDefinition, reading: string | undefined): BoardDefinition {
  if (!def.snapshot) return def;
  const kept: Record<string, Said> = {};
  for (const [path, words] of Object.entries(def.snapshot)) {
    const now = read(def, path);
    const was = pick(words, reading ?? def.lang ?? 'en', def.lang);
    if (now !== undefined && was !== undefined && same(now, was)) kept[path] = words;
  }
  const out = clone(def);
  if (Object.keys(kept).length > 0) out.snapshot = kept;
  else delete out.snapshot;
  return out;
}
