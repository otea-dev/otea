// The two languages a template speaks, and the helpers its data is written with.

export type Lang = 'en' | 'es';

export const LANGS: readonly Lang[] = ['en', 'es'];

export type Words = Readonly<Record<Lang, string>>;

export const w = (en: string, es: string): Words => ({ en, es });

export const EMPTY = w('', '');

export const TITLE_NAME: Words = w('Title', 'Título');

// A level's values as a board in each language says them (Severidad: media), keyed as stored.
export const LEVEL_SAID: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  en: { low: 'low', medium: 'medium', high: 'high', critical: 'critical' },
  es: { low: 'baja', medium: 'media', high: 'alta', critical: 'crítica' },
};

// An effort as the Matrix weighs it: a size, in order, never a level («crítica» reads as a
// priority). Its options and their keys, for a choice part.
export const EFFORT_SIZES = {
  options: [
    w('Small', 'Pequeño'),
    w('Medium', 'Mediano'),
    w('Large', 'Grande'),
    w('Huge', 'Enorme'),
  ],
  optionKeys: ['s', 'm', 'l', 'xl'],
} as const;

// The words the engine itself gives a board, which the board says in its own language (the agent
// reads them so, and so does the desk, whatever its screen's language is): how a closed item reads,
// a yes or no, and a level as a size when it plays the effort (the Matrix; «crítica» reads as a
// priority, never as a size). Levels and yes-or-no are `LEVEL_SAID` and `YES_NO_VALUE`'s.
export const BOARD_WORDS: Readonly<
  Record<
    Lang,
    {
      done: string;
      dropped: string;
      yes: string;
      no: string;
      inReview: string;
      size: Record<string, string>;
    }
  >
> = {
  en: {
    done: 'Done',
    dropped: 'Dropped',
    yes: 'Yes',
    no: 'No',
    inReview: 'in review',
    size: { low: 'small', medium: 'medium', high: 'large', critical: 'huge' },
  },
  es: {
    done: 'Hecho',
    dropped: 'Descartado',
    yes: 'Sí',
    no: 'No',
    inReview: 'en revisión',
    size: { low: 'pequeño', medium: 'mediano', high: 'grande', critical: 'enorme' },
  },
};

// A yes-or-no field's values, as the board says them.
export const YES_NO_SAID: Readonly<Record<Lang, string>> = { en: 'yes or no', es: 'sí or no' };

// A yes-or-no field's stored value (yes, no) as a board in each language says it.
export const YES_NO_VALUE: Readonly<Record<Lang, Readonly<Record<string, string>>>> = {
  en: { yes: 'yes', no: 'no' },
  es: { yes: 'sí', no: 'no' },
};
