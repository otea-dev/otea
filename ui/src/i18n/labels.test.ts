import { describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { es } from './es.ts';

// A message that names a button or a setting by quoting it ("Start directly at…") names it as the
// screen labels it, in the language of the message: the quoted words are the text of another
// message. A Spanish message once quoted «Empieza directamente en…» over a control labelled
// «Empezar directamente en…».

type Catalog = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

// Quoted words that are an example or a value, not a label.
const NOT_LABELS = new Set([
  'refusal.agentName',
  'diagram.why.header',
  'bs.new.itemHint',
  'bs.preview.place.note1',
  'bs.preview.place.note2',
]);

const texts = (catalog: Catalog) =>
  Object.entries(catalog).flatMap(([key, value]) =>
    (typeof value === 'string' ? [value] : Object.values(value)).map(
      (text) => [key, text] as const,
    ),
  );

function unknownLabels(catalog: Catalog, quotes: RegExp): string[] {
  const entries = texts(catalog);
  // A label with a hole ("Start directly at {step}") is quoted without it ("Start directly at…").
  const labels = new Set(
    entries.map(([, text]) =>
      text
        .replace(/\s*\{\w+\}.*$/, '')
        .replace(/…$/, '')
        .toLowerCase(),
    ),
  );
  return entries.flatMap(([key, text]) =>
    NOT_LABELS.has(key)
      ? []
      : [...text.matchAll(quotes)]
          .map(([, quoted = '']) => quoted)
          .filter(
            (quoted) =>
              !quoted.includes('{') && !labels.has(quoted.replace(/…$/, '').toLowerCase()),
          )
          .map((quoted) => `${key}: ${quoted}`),
  );
}

describe('the labels a message quotes', () => {
  it('are the labels the Spanish screen has', () => {
    expect(unknownLabels(es, /«([^»]+)»/g)).toEqual([]);
  });

  it('are the labels the English screen has', () => {
    expect(unknownLabels(en, /“([^”]+)”/g)).toEqual([]);
  });
});
