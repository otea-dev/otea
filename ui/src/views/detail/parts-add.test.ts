import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { renderIn, testApp } from '../../shell/test-app.ts';
import type { ItemView } from '../../types.ts';
import { PartsSection } from './BoardSections.tsx';
import type { ItemLinks } from './board-item.ts';

// P5-F10: the button that adds a part reads as an action on the item's own word, not as the name
// of a step: «Crear tarea de repo, parte de CAM-1».

afterEach(() => setLanguage('en'));

const links: ItemLinks = {
  parent: null,
  parts: [],
  partsBoard: null,
  blockers: [],
  blocking: [],
  related: [],
};

const html = (childItem: string) =>
  renderIn(
    testApp(),
    createElement(PartsSection, {
      item: { id: 'CAM-1', title: 'Cambio', collection: 'Cambios', type: 'item' } as ItemView,
      links,
      boardName: 'Tareas',
      childItem,
      childCollection: 'Tareas',
      canWrite: true,
      now: 0,
    }),
  );

describe('the button that adds a part', () => {
  it('reads Crear + the item word + the parent, never «Crear · Pieza»', () => {
    setLanguage('es');
    const out = html('Tarea de repo');
    expect(out).toContain('Crear tarea de repo, parte de CAM-1');
    expect(out).not.toContain('Crear · ');
    expect(html('Pieza')).toContain('Crear pieza, parte de CAM-1');
  });

  it('reads New + the item word in English, and keeps an acronym as written', () => {
    expect(html('Piece')).toContain('New piece, part of CAM-1');
    expect(html('PR')).toContain('New PR, part of CAM-1');
  });

  it('offers nothing to someone who cannot write', () => {
    const out = renderIn(
      testApp(),
      createElement(PartsSection, {
        item: { id: 'CAM-1', title: 'Cambio', collection: 'Cambios', type: 'item' } as ItemView,
        links,
        boardName: 'Tareas',
        childItem: 'Pieza',
        childCollection: 'Tareas',
        canWrite: false,
        now: 0,
      }),
    );
    expect(out).not.toContain('part of CAM-1');
  });
});
