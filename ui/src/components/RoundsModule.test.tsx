import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { creatures } from '../../../src/core/board/testing.ts';
import { ago, officialType } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import type { ItemEvent, ItemView, TypeView } from '../types.ts';
import { RoundsModule } from './RoundsModule.tsx';

const bug = officialType('bug-triage');
const fresh: ItemView = {
  id: 'ERR-2',
  collection: 'Errores',
  type: bug.name,
  title: 'La niebla parpadea',
  fields: {},
  presetVersion: 1,
  state: 'reported',
  turn: 'human',
  createdAt: ago(10),
  updatedAt: ago(10),
  createdBy: { kind: 'agent', name: 'Scout' },
  lease: null,
  events: [],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
};
const render = (quiet?: boolean) =>
  renderToStaticMarkup(
    <RoundsModule
      item={fresh}
      type={bug}
      entry={{ module: 'rounds' }}
      canWrite
      {...(quiet ? { quiet } : {})}
    />,
  );

describe('RoundsModule', () => {
  it('says there are no rounds yet, unless a board already draws its round notes (quiet)', () => {
    expect(render()).toContain('rd-none');
    expect(render(true)).toBe('');
  });
});

afterEach(() => setLanguage('en'));

const scout = { kind: 'agent' as const, name: 'scout' };
const you = { kind: 'human' as const, name: 'human' };
let ids = 0;
const moved = (at: string, actor: ItemEvent['actor'], from: string, to: string): ItemEvent => ({
  id: ++ids,
  type: 'transitioned',
  actor,
  at: `2026-11-12T${at}:00.000Z`,
  data: { from, to, reason: 'x' },
});
// Two rounds: the first sent back, the second approved into a closing state.
const fixed: ItemView = {
  ...fresh,
  state: 'fixed',
  turn: 'none',
  events: [
    moved('20:10', scout, 'accepted', 'fixing'),
    moved('20:20', scout, 'fixing', 'verify'),
    moved('20:28', you, 'verify', 'fixing'),
    moved('20:30', scout, 'fixing', 'verify'),
    moved('20:35', you, 'verify', 'fixed'),
  ],
};
const renderFixed = () =>
  renderToStaticMarkup(
    <RoundsModule item={fixed} type={bug} entry={{ module: 'rounds' }} canWrite />,
  );

describe('the rounds’ route', () => {
  it('names the state a round closed in with the preset’s word for the language on screen', () => {
    setLanguage('es');
    const html = renderFixed();
    expect(html).toContain('Arreglado');
    expect(html).not.toMatch(/>fixed</);
  });

  it('stacks each label under its node in lines narrower than the gap between nodes', () => {
    setLanguage('es');
    const html = renderFixed();
    const labels = html.match(/<span class="rd-label"[^>]*>.*?<\/span><\/span>/g) ?? [];
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      // the round, when it was handed in, and the verdict: each on its own line
      expect(label.match(/\brd-line\b/g)).toHaveLength(2);
      expect(label).toMatch(/title="[^"]+"/);
    }
  });
});

// P5-F1: Comparar rondas showed two identical pictures with no word when a round attached the very
// file of the round before.
describe('Comparar rondas when a round attached the same file again', () => {
  const withFiles: TypeView = {
    ...bug,
    layout: { ...bug.layout, evidence: [{ module: 'files' as const, id: 'efile' }] },
  };
  const shot = (id: number, at: string, sha256: string) => ({
    id,
    itemId: 'ERR-2',
    role: 'single' as const,
    module: 'efile',
    kind: 'image' as const,
    filename: 'icono.png',
    contentType: 'image/png',
    size: 4,
    sha256,
    caption: null,
    createdAt: `2026-11-12T${at}:00.000Z`,
    actor: scout,
    channel: 'cli',
  });
  const render = (second: string) =>
    renderToStaticMarkup(
      <RoundsModule
        item={{ ...fixed, evidence: [shot(1, '20:15', 'aa'), shot(2, '20:25', second)] }}
        type={withFiles}
        entry={{ module: 'rounds' }}
        canWrite
      />,
    );

  it('says nothing changed when the bytes are the same', () => {
    setLanguage('es');
    const html = render('aa');
    expect(html).toContain('Comparar rondas');
    expect(html).toContain('Igual que la ronda 1: el archivo no cambió');
  });

  it('says nothing when the bytes changed', () => {
    setLanguage('es');
    const html = render('bb');
    expect(html).toContain('Comparar rondas');
    expect(html).not.toContain('no cambió');
  });
});

describe('the count of rounds, as the row says it', () => {
  it('names the round under way once it was sent back, as the row does', () => {
    setLanguage('es');
    const back: ItemView = {
      ...fresh,
      state: 'fixing',
      turn: 'agent',
      events: [
        moved('20:10', scout, 'accepted', 'fixing'),
        moved('20:20', scout, 'fixing', 'verify'),
        moved('20:28', you, 'verify', 'fixing'),
      ],
    };
    const html = renderToStaticMarkup(
      <RoundsModule item={back} type={bug} entry={{ module: 'rounds' }} canWrite />,
    );
    expect(html).toContain('ronda 2 en curso');
    expect(html).not.toContain('1 ronda<');
  });
});

describe('the rounds of a board step', () => {
  // Concepto handed in by pinta with a note, sent back, handed in again and approved into Animar.
  const def = creatures();
  const pinta = { kind: 'agent' as const, name: 'pinta' };
  const at = (time: string) => `2026-11-12T${time}:00.000Z`;
  const step = (time: string, actor: ItemEvent['actor'], from: string, to: string, data = {}) => ({
    id: ++ids,
    type: 'transitioned',
    actor,
    at: at(time),
    data: { from, to, ...data },
  });
  const onBoard: ItemView = {
    ...fresh,
    state: 'sanimate',
    turn: 'agent',
    events: [
      { id: ++ids, type: 'created', actor: you, at: at('09:00'), data: { state: 'sconcept' } },
      step('09:10', pinta, 'sconcept', 'sconcept__review', { note: 'Dos bocetos' }),
      step('09:20', you, 'sconcept__review', 'sconcept', { reason: 'Más barro' }),
      step('09:30', pinta, 'sconcept', 'sconcept__review', { note: 'Con barro' }),
      step('09:40', you, 'sconcept__review', 'sanimate'),
    ],
  };
  const states = [
    { name: 'sconcept', turn: 'agent' as const },
    { name: 'sconcept__review', turn: 'human' as const },
    { name: 'sanimate', turn: 'agent' as const },
  ];

  it('shows each round’s note and calls the approved round approved, not sent back', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      <RoundsModule
        item={onBoard}
        type={{ ...bug, states }}
        entry={{ module: 'rounds' }}
        canWrite
        quiet
        board={{ def, step: 'sconcept' }}
      />,
    );
    expect(html).toContain('Dos bocetos');
    expect(html).toContain('Con barro');
    expect(html).not.toContain('sin nota');
    const labels = html.match(/<span class="rd-label"[^>]*>.*?<\/span><\/span>/g) ?? [];
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('devuelta');
    expect(labels[1]).toContain('aprobada');
    expect(labels[1]).not.toContain('devuelta');
  });

  // P1-F1: a relayed verdict leads with who relayed it and what they quoted, never a bold «aprobada».
  it('leads a relayed verdict with who relayed it and the quote, never with «aprobada»', () => {
    setLanguage('es');
    const relayed: ItemView = {
      ...onBoard,
      events: [
        ...onBoard.events.slice(0, 4),
        step('09:40', you, 'sconcept__review', 'sanimate', { via: 'orch', quote: 'dale' }),
      ],
    };
    const html = renderToStaticMarkup(
      <RoundsModule
        item={relayed}
        type={{ ...bug, states }}
        entry={{ module: 'rounds' }}
        canWrite
        quiet
        board={{ def, step: 'sconcept' }}
      />,
    );
    expect(html).toContain('data-relayed');
    expect(html).toContain('<b>transmitida por orch, citando &quot;dale&quot;</b>');
    expect(html).not.toContain('<b>aprobada');
  });

  it('names the step whose rounds it shows when the item went through several', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      <RoundsModule
        item={onBoard}
        type={{ ...bug, states }}
        entry={{ module: 'rounds' }}
        canWrite
        quiet
        board={{ def, step: 'sconcept' }}
        stepName="Concepto"
      />,
    );
    expect(html).toContain('<h2 class="t-label">Rondas de Concepto</h2>');
    expect(html).toContain('aria-label="Rondas de Concepto"');
  });
});
