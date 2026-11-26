import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { textOf } from '../html-text.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { captureTarget, TabBarView, type TabBarViewProps, tabBarFor, tabOn } from './TabBar.tsx';

afterEach(() => setLanguage('en'));

const ws = { intake: null, activity: false };

const props = (o: Partial<TabBarViewProps> = {}): TabBarViewProps => ({
  on: 'toca',
  toca: 2,
  panelOpen: false,
  canCreate: true,
  onToca: () => {},
  onHablar: () => {},
  onNew: () => {},
  onPanel: () => {},
  ...o,
});
const render = (p: TabBarViewProps) => renderToStaticMarkup(createElement(TabBarView, p));
const text = textOf;

describe('tabBarFor (mock 1, 4)', () => {
  it('stands on every page of the project', () => {
    for (const view of ['toca', 'atasco', 'triage', 'settings', 'projects'] as const)
      expect(tabBarFor({ view }, ws), view).toBe(true);
    expect(tabBarFor({ view: 'board', board: 'Tareas' }, ws)).toBe(true);
    expect(tabBarFor({ view: 'studio', page: { kind: 'boards' } }, ws)).toBe(true);
  });

  it('goes while an item, the new item page or the activity drawer takes the screen', () => {
    expect(tabBarFor({ view: 'toca', item: 'TAR-1' }, ws)).toBe(false);
    expect(tabBarFor({ view: 'toca' }, { ...ws, intake: { board: 'Tareas' } })).toBe(false);
    expect(tabBarFor({ view: 'toca' }, { ...ws, activity: true })).toBe(false);
  });
});

describe('tabOn', () => {
  it('lights Te toca on your lists and Panel on a board', () => {
    expect(tabOn({ view: 'toca' })).toBe('toca');
    expect(tabOn({ view: 'lan' })).toBe('toca');
    expect(tabOn({ view: 'atasco' })).toBe('toca');
    expect(tabOn({ view: 'triage' })).toBe('toca');
    expect(tabOn({ view: 'board', board: 'Tareas' })).toBe('panel');
    expect(tabOn({ view: 'settings' })).toBeNull();
  });

  // Field study 3: Hablar was Panel > Hablar, two taps, on the phone.
  it('lights Hablar on the conversation, whatever turn or note it is open at', () => {
    expect(tabOn({ view: 'hablar' })).toBe('hablar');
    expect(tabOn({ view: 'hablar', turn: 4 })).toBe('hablar');
    expect(tabOn({ view: 'hablar', bandeja: 'B-2' })).toBe('hablar');
  });
});

describe('TabBarView', () => {
  it('is four tabs in a row: Hablar, Te toca with its count, Nuevo, Panel', () => {
    const html = render(props());
    expect(html).toMatch(/^<nav class="tabbar" aria-label="Navigation">/);
    const order = [
      'data-tab="hablar"',
      'Talk',
      'data-tab="toca"',
      'Your turn',
      'data-tab="new"',
      'New',
      'data-tab="panel"',
    ];
    let at = -1;
    for (const w of order) {
      const i = html.indexOf(w, at + 1);
      expect(i, w).toBeGreaterThan(at);
      at = i;
    }
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toMatch(/class="tbadge"[^>]*>2</);
    expect(text(html)).toBe('Talk2Your turnNewPanel');
  });

  it('lights Hablar when the conversation is open', () => {
    const html = render(props({ on: 'hablar' }));
    expect(html).toMatch(/class="tab on"[^>]*data-tab="hablar"[^>]*aria-current="page"/);
  });

  it('marks where you are and that the panel opens a sheet', () => {
    const html = render(props({ on: 'panel', panelOpen: true }));
    expect(html).toMatch(/<button[^>]*class="tab on"[^>]*data-tab="panel"[^>]*aria-current="page"/);
    expect(html).toMatch(/data-tab="panel"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="true"/);
    expect(html.match(/class="tab on"/g)).toHaveLength(1);
  });

  it('says nothing for nothing waiting', () => {
    expect(render(props({ toca: 0 }))).not.toContain('class="tbadge"');
  });

  it('cannot create without the right to write', () => {
    expect(render(props({ canCreate: false }))).toMatch(/data-tab="new"[^>]*disabled=""/);
  });

  it('speaks Spanish', () => {
    setLanguage('es');
    const html = render(props());
    expect(html).toContain('aria-label="Navegación"');
    expect(text(html)).toBe('Hablar2Te tocaNuevoPanel');
  });
});

describe('captureTarget', () => {
  it('captures on the board in view; anywhere else the capture picks the board', () => {
    expect(captureTarget({ view: 'board', board: 'Tareas' })).toEqual({ board: 'Tareas' });
    expect(captureTarget({ view: 'toca' })).toEqual({});
    expect(captureTarget({ view: 'settings' })).toEqual({});
  });
});
