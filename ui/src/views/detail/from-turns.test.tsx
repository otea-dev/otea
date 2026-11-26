// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../../app/context.tsx';
import { ago, officialType } from '../../derive/fixtures.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, stubServer } from '../../test-dom.tsx';
import type { CollectionView, ItemView } from '../../types.ts';
import { ItemSheet } from './ItemSheet.tsx';

// An item that came out of the conversation with the secretary says so on its page, and the line
// opens Hablar at that turn.

const bug = officialType('bug-triage');
const errores = {
  name: 'Errores',
  prefix: 'ERR',
  preset: 'bug-triage',
  types: [bug],
} as unknown as CollectionView;

const made = (o: Partial<ItemView> = {}): ItemView => ({
  id: 'ERR-214',
  collection: 'Errores',
  type: bug.name,
  title: 'La barra fija tapa Aprobar',
  fields: { severity: 'high', category: 'gameplay' },
  presetVersion: 3,
  state: 'fixing',
  turn: 'agent',
  createdAt: ago(900),
  updatedAt: ago(5),
  createdBy: { kind: 'agent', name: 'quill' },
  lease: null,
  events: [],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
  ...o,
});

let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('es');
  stubServer();
  window.localStorage.clear();
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  setLanguage('en');
});

const open = (item: ItemView) => {
  page = mount(
    <AppTestProvider value={testApp({ collections: [errores] })}>
      <ItemSheet
        item={item}
        full={false}
        nav={{ prev: false, next: false }}
        onNav={() => undefined}
        onFull={() => undefined}
        onClose={() => undefined}
      />
    </AppTestProvider>,
  );
  return page.root;
};

describe('an item that came out of Hablar', () => {
  it('links back to the turn it came from', () => {
    const root = open(
      made({
        fromMessages: [
          {
            id: 7,
            at: ago(40),
            author: 'person',
            kind: 'request',
            snippet: 'El botón Aprobar queda tapado',
          },
        ],
      }),
    );

    const link = root.querySelector<HTMLAnchorElement>('.hb-from a');
    expect(link?.getAttribute('href')).toBe('#/hablar/7');
    expect(link?.textContent).toBe('salió de Hablar · «El botón Aprobar queda tapado»');
  });

  it('shows no such line on an item that came from elsewhere', () => {
    expect(open(made()).querySelector('.hb-from')).toBeNull();
  });
});
