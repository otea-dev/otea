import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { creatures } from '../../../../src/core/board/testing.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { Evidence, ItemView, Layout, TypeView } from '../../types.ts';
import { bodySections } from './Body.tsx';
import { evidenceGaps } from './board-item.ts';
import type { Facts } from './facts.ts';

afterEach(() => setLanguage('en'));

// A board whose Animar step requires a report and asks for at least one of a recording, a
// screenshot or a log; a review shows only what was attached.
const def = creatures();
for (const [id, name, kind] of [
  ['efile', 'Informe', 'file'],
  ['eshot', 'Captura', 'images'],
  ['elog', 'Salida', 'log'],
] as const) {
  def.parts[id] = { id, name, kind, hint: '', options: [] };
}
const animar = def.steps[1];
if (!animar) throw new Error('no step');
animar.hand = [
  { ref: 'efile', req: 'always', fresh: false },
  { ref: 'eanim', req: 'no', fresh: false },
  { ref: 'eshot', req: 'no', fresh: false },
  { ref: 'elog', req: 'no', fresh: false },
];
animar.groups = [{ id: 'gproof', name: 'Prueba', parts: ['eanim', 'eshot', 'elog'], min: 1 }];

const EMPTY: Layout = {
  header: [],
  evidence: [],
  body: [],
  side: [],
  row: [],
  phone: [],
  intake: [],
};

const type = {
  name: 'item',
  label: 'Criatura',
  initial: 'sconcept',
  states: [],
  fields: [{ name: 'title', module: 'text', required: 'create' }],
  layout: {
    ...EMPTY,
    body: [
      { module: 'files', id: 'efile', label: 'Informe' },
      { module: 'recording', id: 'eanim', label: 'Animación' },
      { module: 'images', id: 'eshot', label: 'Captura' },
      { module: 'log', id: 'elog', label: 'Salida' },
    ],
  },
} as unknown as TypeView;

const file = (id: number, module: string, filename: string, size = 12): Evidence => ({
  id,
  itemId: 'CRI-1',
  role: 'single',
  module,
  kind: 'log',
  filename,
  contentType: 'text/plain',
  size,
  sha256: '',
  caption: null,
  createdAt: '2026-11-17T09:00:00.000Z',
  actor: { kind: 'agent', name: 'quill' },
  channel: 'cli',
});

const item = (evidence: Evidence[]) =>
  ({
    id: 'CRI-1',
    collection: 'Criaturas',
    type: 'item',
    state: 'sanimate__review',
    turn: 'human',
    createdAt: '2026-11-17T08:00:00.000Z',
    fields: { title: 'Rana' },
    evidence,
    events: [],
  }) as unknown as ItemView;

// The page's evidence section, drawn as the desk draws it for a signed-in viewer.
function evidenceMarkup(on: ItemView): string {
  const sections = bodySections({
    item: on,
    type,
    facts: {} as Facts,
    canWrite: false,
    now: 0,
    board: {
      options: new Set(),
      rounds: null,
      roundsAfter: false,
      sections: [],
      steps: { def },
      gaps: evidenceGaps(def, on),
    },
  });
  return renderToStaticMarkup(<>{sections.find(({ key }) => key === 'evidence')?.node}</>);
}

describe('the review of a delivery with mixed evidence', () => {
  const delivered = item([file(1, 'efile', 'informe.txt'), file(2, 'elog', 'salida.log')]);

  it('draws only the evidence that has content, and says the optional ones apart', () => {
    const markup = evidenceMarkup(delivered);
    expect(markup).toContain('data-module="files"');
    expect(markup).toContain('data-module="log"');
    // Nothing for the recording and the screenshot nobody attached: no well, no «yet».
    expect(markup).not.toContain('data-module="recording"');
    expect(markup).not.toContain('data-module="images"');
    expect(markup).not.toContain('ev-empty');
    expect(markup).toContain('+ Animación, Captura (optional, not provided)');
  });

  it('says the quiet line in Spanish', () => {
    setLanguage('es');
    expect(evidenceMarkup(delivered)).toContain('+ Animación, Captura (opcionales, sin cargar)');
  });

  it('shows required evidence that is missing in red, dashed, and the group that is not met', () => {
    const markup = evidenceMarkup(item([]));
    expect(markup).toContain('class="ev-empty well" data-required="true"');
    expect(markup).toContain('data-module="files"');
    expect(markup).toContain('ev-gap miss');
    expect(markup).toContain('Prueba: at least 1 of Animación, Captura, or Salida (0 attached)');
  });

  // P5-F6: «(1 adjuntados)». The count agrees with what it counts, and a group new in each round
  // says so.
  it('agrees the count of a short group in Spanish, and says when it is new each round', () => {
    // The fixture is shared: what is changed here is put back as it was, value by value.
    const originalGroups = animar.groups;
    const originalHand = animar.hand.map((hand) => ({ ...hand }));
    animar.groups = [{ id: 'gproof', name: 'Prueba', parts: ['eanim', 'eshot', 'elog'], min: 2 }];
    try {
      setLanguage('es');
      const one = evidenceMarkup(item([file(1, 'efile', 'informe.txt'), file(2, 'elog', 's.log')]));
      expect(one).toContain('(1 adjuntado)');
      const none = evidenceMarkup(item([file(1, 'efile', 'informe.txt')]));
      expect(none).toContain('(0 adjuntados)');

      // Some parts new each round: the line says which, since counting discards only their older
      // files; all of them, that every part is.
      setLanguage('en');
      const hand = (ref: string) => animar.hand.find((entry) => entry.ref === ref);
      const some = hand('eshot');
      if (some) some.fresh = true;
      expect(evidenceMarkup(item([file(1, 'efile', 'informe.txt')]))).toContain(
        'at least 2 of Animación, Captura, or Salida, new this round: Captura (0 attached)',
      );
      for (const ref of ['eanim', 'eshot', 'elog']) {
        const part = hand(ref);
        if (part) part.fresh = true;
      }
      expect(evidenceMarkup(item([file(1, 'efile', 'informe.txt')]))).toContain(
        'at least 2 of Animación, Captura, or Salida, each new this round (0 attached)',
      );
    } finally {
      if (originalGroups) animar.groups = originalGroups;
      else delete animar.groups;
      animar.hand = originalHand;
    }
  });

  it('counts a file with no bytes as nothing', () => {
    const gaps = evidenceGaps(def, item([file(1, 'efile', 'informe.txt', 0)]));
    expect(gaps.required.map(({ ref }) => ref)).toEqual(['efile']);
    expect(gaps.groups).toHaveLength(1);
  });

  it('asks for nothing once the group is met by one of its parts', () => {
    const gaps = evidenceGaps(def, delivered);
    expect(gaps.required).toEqual([]);
    expect(gaps.groups).toEqual([]);
    expect(gaps.optional).toEqual(['Animación', 'Captura']);
  });
});
