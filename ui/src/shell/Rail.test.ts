import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { workspace } from '../app/workspace.ts';
import { ago, item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import type { CollectionView } from '../types.ts';
import { Rail } from './Rail.tsx';
import { renderIn, testApp } from './test-app.ts';

afterEach(() => {
  setLanguage('en');
  workspace.set({ folded: false });
});

// The markup from one row's data-k to the next row's (or the end of its nav).
const rowOf = (html: string, k: string) => {
  const at = html.indexOf(`data-k="${k}"`);
  const start = html.lastIndexOf('<div', at);
  const end = html.indexOf('</div>', at);
  return html.slice(start, end + '</div>'.length);
};

const board = (name: string, icon: string | null = null) =>
  ({ name, icon, types: [] }) as unknown as CollectionView;

const all = [
  item({ id: 'E1', collection: 'Errores', turn: 'human' }),
  item({ id: 'E2', collection: 'Errores', turn: 'agent' }),
  item({
    id: 'E3',
    collection: 'Errores',
    turn: 'agent',
    expiredLease: { holder: 'Kiln', expiresAt: ago(10) },
  }),
  item({ id: 'C1', collection: 'Criaturas', turn: 'agent' }),
];

const rail = (o: Parameters<typeof testApp>[0] = {}) => {
  setLanguage('es');
  return renderIn(
    testApp({ all, collections: [board('Errores', 'bug'), board('Criaturas', 'paw')], ...o }),
    createElement(Rail),
  );
};

describe('the rail', () => {
  // The + names what it makes: beside the word vistas it read as a new view (P7-14).
  it('heads with the fold and a new item that says so, the views label under them', () => {
    const html = rail();
    expect(html).toMatch(/class="ibtn"[^>]*aria-expanded="true"[^>]*aria-label="Ocultar el panel"/);
    expect(html).toMatch(
      /<button type="button" class="rnew"[^>]*>.*?<span class="lbl">Nuevo ítem<\/span><\/button>/,
    );
    expect(html).toContain('<div class="rail-label first">vistas</div>');
    expect(html.indexOf('class="rnew"')).toBeLessThan(html.indexOf('vistas</div>'));
    expect(html.indexOf('vistas</div>')).toBeLessThan(html.indexOf('Te toca'));
  });

  it('counts Te toca in your blue and Atasco in warn, each with its folded badge', () => {
    const html = rail();
    expect(html).toMatch(
      /Te toca<\/span><span class="pair"><span class="n you"><span class="nv" data-v="2">/,
    );
    expect(html).toMatch(
      /Atasco<\/span><span class="pair"><span class="n warn"><span class="nv" data-v="1">/,
    );
    expect(html).toContain('<i class="badge has">2</i>');
    expect(html).toContain('<i class="badge warn has">1</i>');
  });

  it('lists each board with its icon, yours over open, and a + for a new item in it', () => {
    const html = rail();
    expect(html).toContain('<div class="rail-label">tableros</div>');
    expect(html).toMatch(
      /Errores<\/span><span class="pair"[^>]*><span class="n you"><span class="nv" data-v="1">1<\/span><\/span> \/ <span class="n"><span class="nv" data-v="3">3/,
    );
    expect(html).toContain('aria-label="Nuevo ítem en Errores"');
    expect(html).toContain('Nuevo tablero');
  });

  // The + takes the pair's place under the pointer, so the row itself says what the pair counts,
  // folded or not.
  it('says what a board’s pair counts when you rest on its row', () => {
    expect(rail()).toMatch(
      /data-k="board:Errores" data-tip="Errores · Te toca: 1 · Abiertos: 3" data-tip-more=""/,
    );
    setLanguage('en');
    const en = renderIn(
      testApp({ all, collections: [board('Errores', 'bug'), board('Criaturas', 'paw')] }),
      createElement(Rail),
    );
    expect(en).toContain('data-tip="Errores · Your turn: 1 · Open: 3" data-tip-more=""');
    // Te toca and Atasco count one thing each: their rows name it, and say nothing more.
    expect(rail()).toMatch(/data-k="toca" data-tip="Te toca">/);
  });

  // F4: a question on a note or the secretary's own waits for you as much as an item does.
  it('counts in Te toca the questions of the Bandeja and the secretary, beside the items', () => {
    const countOf = (html: string) => /data-k="toca"[\s\S]*?data-v="(\d+)"/.exec(html)?.[1];
    const ask = (kind: 'bandeja' | 'secretary', ref: string) => ({
      kind,
      ref,
      title: 'x',
      since: ago(5),
    });

    expect(countOf(rail())).toBe('2');
    expect(
      countOf(
        rail({
          pending: {
            count: 2,
            entries: [ask('bandeja', 'B-1'), ask('secretary', '4')],
            blocks: [],
            secretary: null,
          },
        }),
      ),
    ).toBe('4');
  });

  it('marks the row in view and slides one pill under it', () => {
    const html = rail({ route: { view: 'board', board: 'Criaturas' } });
    expect(html).toMatch(/class="nrow on"[^>]*aria-current="page"[^>]*data-k="board:Criaturas"/);
    expect(html.match(/class="rsel"/g)).toHaveLength(1);
  });

  // Hablar is the first view: the secretary's mark in its colour, then Te toca and Atasco. The old
  // Temas row is gone: its consultations live in Hablar's filter.
  it('opens the views with Hablar and its mark, before Te toca and Atasco', () => {
    const html = rail();
    const order = [
      'vistas</div>',
      'data-k="hablar"',
      'data-k="toca"',
      'data-k="atasco"',
      'tableros</div>',
      'proyecto</div>',
    ];
    let at = -1;
    for (const w of order) {
      const i = html.indexOf(w);
      expect(i, w).toBeGreaterThan(at);
      at = i;
    }
    expect(rowOf(html, 'hablar')).toContain('<span class="mk secretary">se</span>');
    expect(rowOf(html, 'hablar')).toContain('<span class="lb">Hablar</span>');
    expect(html).not.toContain('data-k="topics"');
    expect(html).not.toContain('Temas');
    // Studio, Configuración and Rendimiento keep the project to themselves.
    const project = html.slice(html.indexOf('proyecto</div>'));
    expect(project.indexOf('data-k="studio"')).toBeLessThan(project.indexOf('data-k="settings"'));
    expect(project.indexOf('data-k="settings"')).toBeLessThan(
      project.indexOf('data-k="performance"'),
    );
  });

  it('slides the pill under Hablar while you talk', () => {
    const html = rail({ route: { view: 'hablar' } });
    expect(html.match(/class="nrow[^"]*\bon\b/g)).toHaveLength(1);
    expect(rowOf(html, 'hablar')).toMatch(/^<div class="nrow on"[^>]*aria-current="page"/);
  });

  it('keeps the project’s Studio and its settings, even for a browser without a session', () => {
    const html = rail();
    expect(html).toContain('<div class="rail-label">proyecto</div>');
    expect(html).toContain('Studio');
    expect(html).toContain('Configuración');
    const reader = rail({
      session: { canWrite: false, canConfigure: false, canManageDevices: false },
    });
    // Its page says how to sign in; hiding the row made the owner think it was gone.
    expect(rowOf(reader, 'settings')).toContain('Configuración');
    expect(reader).not.toContain('Nuevo tablero');
    expect(reader).not.toContain('class="rnew"');
    expect(reader).toContain('<div class="rail-label first">vistas</div>');
  });

  it('says it opens again once folded', () => {
    workspace.set({ folded: true });
    expect(rail()).toMatch(/aria-expanded="false"[^>]*aria-label="Mostrar el panel"/);
  });
});
