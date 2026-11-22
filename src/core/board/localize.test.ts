import { describe, expect, it } from 'vitest';
import { sequenceIds } from './ids.ts';
import { wayByName } from './next.ts';
import { readDefinition, storedDefinition } from './schema.ts';
import {
  blankBoard,
  boardLang,
  instantiate,
  instantiateSet,
  LANGS,
  type Lang,
  optionKey,
  TEMPLATE_SETS,
  TEMPLATES,
} from './templates.ts';

// A board keeps the words its template gave it in every language, on the board: it reads in the
// language asked, never looks at the template again, and a word its person changed is theirs in
// every language.

const template = (key: string) => {
  const found = TEMPLATES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No template ${key}`);
  return found;
};

const made = (key: string, lang: Lang, name?: string) =>
  instantiate(template(key), lang, name ? { name } : {}, sequenceIds());

const otherThan = (lang: Lang): Lang => (lang === 'es' ? 'en' : 'es');

describe('the words of a board made from a template', () => {
  it.each(TEMPLATES.flatMap((candidate) => LANGS.map((lang) => ({ key: candidate.key, lang }))))(
    '$key made in $lang reads back as made, and in the other language as that language says it',
    ({ key, lang }) => {
      const def = made(key, lang);
      const json = storedDefinition(def);
      const other = otherThan(lang);

      expect(readDefinition(json, lang)).toEqual(def);
      // The same board in the other language: every name, hint and instruction, and nothing mixed.
      // (Its name is the one it was given, which every language says.)
      expect(readDefinition(json, other)).toEqual({ ...made(key, other, def.name), lang });
    },
  );

  it.each(TEMPLATE_SETS.flatMap((set) => LANGS.map((lang) => ({ set, lang }))))(
    'every board of the set $set.key made in $lang reads whole in the other language, texts naming its sibling boards included',
    ({ set, lang }) => {
      const other = otherThan(lang);
      const ids = set.boards.map((_, index) => ({ id: `b${index}` }));
      const defs = instantiateSet(set, lang, ids, sequenceIds());
      const named = ids.map(({ id }, index) => ({ id, name: defs[index]?.name ?? '' }));
      const expected = instantiateSet(set, other, named, sequenceIds());
      defs.forEach((def, index) => {
        const json = storedDefinition(def);
        expect(readDefinition(json, lang)).toEqual(def);
        // Instructions and hints too, not only names: the texts that name the other boards of the
        // set say those boards' names, in the language read.
        expect(readDefinition(json, other)).toEqual({ ...expected[index], lang });
      });
    },
  );

  it('says a blank board in both languages too', () => {
    const json = storedDefinition(blankBoard('es', { name: 'Mi tablero' }, sequenceIds()));
    expect(readDefinition(json, 'es').title).toBe('Título');
    expect(readDefinition(json, 'en').title).toBe('Title');
    expect(readDefinition(json, 'en').steps[0]?.name).toBe('Do it');
  });

  // The words made about a board for its agents and its Pedido (a retitled request, the reason a
  // request closes with) are said in the language the board was made in, not the desk's.
  it('says the language a board was made in whichever language it is read in', () => {
    const json = storedDefinition(made('bugs', 'es'));
    expect(boardLang(readDefinition(json, 'en'))).toBe('es');
    expect(boardLang(readDefinition(json, 'es'))).toBe('es');
  });

  // `--way` takes the name `next` prints, or the step's stable key, which a language or a rename
  // does not change.
  it('names a way by the step key as well as by its name, in any language', () => {
    const def = made('bugs', 'es');
    const json = storedDefinition(def);
    const [refine, fix] = def.steps;
    if (!refine || !fix) throw new Error('the template has no two steps');
    for (const lang of LANGS) {
      const read = readDefinition(json, lang);
      expect(wayByName(read, refine.id, 'fix')).toBe(fix.id);
      expect(wayByName(read, refine.id, read.steps[1]?.name ?? '')).toBe(fix.id);
    }
    const renamed = {
      ...def,
      steps: def.steps.map((step) => ({ ...step, name: `${step.name} 2` })),
    };
    expect(wayByName(renamed, refine.id, 'fix')).toBe(fix.id);
  });

  it('reads a board in the language it was made in when the reader says none', () => {
    const json = storedDefinition(made('bugs', 'es'));
    expect(readDefinition(json).steps[0]?.name).toBe('Refinar');
    expect(readDefinition(json, 'en').steps[0]?.name).toBe('Refine');
  });

  it('keeps what a person changed, in every language, even when it is what another language says', () => {
    const def = made('bugs', 'es');
    const [first] = def.steps;
    const field = Object.values(def.parts)[0];
    if (!first || !field) throw new Error('the template has no step or field');
    // Renamed to exactly what the English board calls the step, an instruction rewritten, a field
    // renamed.
    first.name = 'Refine';
    first.instructions.take = 'Antes de nada, pide el log.';
    field.name = 'Lo que vio la jugadora';

    const json = storedDefinition(def, 'es');
    for (const lang of LANGS) {
      const read = readDefinition(json, lang);
      expect(read.steps[0]?.name).toBe('Refine');
      expect(read.steps[0]?.instructions.take).toBe('Antes de nada, pide el log.');
      expect(read.parts[field.id]?.name).toBe('Lo que vio la jugadora');
    }
    // What it did not change still follows the language.
    expect(readDefinition(json, 'es').steps[1]?.name).toBe('Arreglar');
    expect(readDefinition(json, 'en').steps[1]?.name).toBe('Fix');
    expect(readDefinition(json, 'en').title).toBe('Title');
  });

  // A release that speaks one more language makes boards in it; an older binary reads them: in the
  // language asked when the board has it, else the board's own, else any it has.
  it('reads a board made by a later release in a language this one does not speak', () => {
    const stored = JSON.parse(storedDefinition(made('bugs', 'es'))) as Record<string, unknown>;
    stored.lang = 'fr';
    const json = JSON.stringify(stored);
    expect(readDefinition(json, 'en').steps[0]?.name).toBe('Refine');
    expect(readDefinition(json, 'es').steps[0]?.name).toBe('Refinar');
    expect(readDefinition(json).steps[0]?.name).toBeTypeOf('string');
    expect(['en', 'es']).toContain(boardLang(readDefinition(json)));
  });

  it('keeps a board whole through a read, an edit and a save in the other language', () => {
    const def = made('bugs', 'es');
    const english = readDefinition(storedDefinition(def), 'en');
    const [first] = english.steps;
    if (!first) throw new Error('no step');
    first.name = 'Look into it';
    const saved = storedDefinition(english, 'en');

    const steps = (lang: Lang) => readDefinition(saved, lang).steps.map((step) => step.name);
    expect(steps('en')).toEqual(['Look into it', 'Fix']);
    expect(steps('es')).toEqual(['Look into it', 'Arreglar']);
    // Read again in the language it was made in, nothing else was lost or mixed.
    expect({ ...readDefinition(saved, 'es'), steps: [], snapshot: undefined }).toEqual({
      ...def,
      steps: [],
      snapshot: undefined,
    });
  });

  // A release may rename or drop a template's keys, reorder its options or remove it: a board made
  // before reads as it did, because it reads nothing of the template.
  // (The shared templates are never changed to show it: the stored board is written the way a later
  // release's template would have keyed it, every key renamed, and read as it is.)
  it('still reads a board whose template keys changed since it was made', () => {
    const json = storedDefinition(made('bugs', 'es'));
    const renamed = JSON.stringify(JSON.parse(json), (name, value: unknown) =>
      name === 'key' && typeof value === 'string' ? `${value}_in_a_later_release` : value,
    );
    expect(renamed).not.toBe(json);
    for (const lang of LANGS) {
      const read = (text: string) => JSON.parse(JSON.stringify(readDefinition(text, lang)));
      const strip = (def: Record<string, unknown>) =>
        JSON.parse(
          JSON.stringify(def, (name, value: unknown) => (name === 'key' ? undefined : value)),
        );
      expect(strip(read(renamed))).toEqual(strip(read(json)));
    }
  });

  it('reads a stored board whose template no release has', () => {
    const stored = JSON.parse(storedDefinition(made('bugs', 'es'))) as Record<string, unknown>;
    stored.template = 'removed-in-a-later-release';
    expect(readDefinition(JSON.stringify(stored), 'en').steps[0]?.name).toBe('Refine');
  });

  it('reads a board written before snapshots as it says itself, in any language', () => {
    const old = JSON.parse(JSON.stringify(made('bugs', 'es'))) as Record<string, unknown>;
    delete old.snapshot;
    delete old.lang;
    const json = JSON.stringify(old);
    expect(readDefinition(json, 'en').steps[0]?.name).toBe('Refinar');
    expect(readDefinition(json, 'en').title).toBe('Título');
  });

  // The keys a template gives its steps, choices and motives are what an agent may name instead of
  // a name (`--way land`) and what a stored board's keys read as, so the step keys, the option keys
  // (and so their order) and the motive keys are pinned: changing one is a decision, not an edit.
  it('pins the step, option and motive keys of every template', () => {
    const shape = Object.fromEntries(
      TEMPLATES.map((candidate) => [
        candidate.key,
        {
          steps: candidate.steps.map((step) => step.key),
          options: Object.fromEntries(
            candidate.parts
              .filter((part) => (part.options ?? []).length > 0)
              .map((part) => [part.key, (part.options ?? []).map((_, at) => optionKey(part, at))]),
          ),
          motives: (candidate.motives ?? []).map(([key]) => key),
        },
      ]),
    );
    expect(shape).toMatchSnapshot();
  });
});
