// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerGiven } from '../../api.ts';
import { type App, AppTestProvider } from '../../app/context.tsx';
import { ago, officialType } from '../../derive/fixtures.ts';
import { setLanguage, t } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press, stubServer, typeInto } from '../../test-dom.tsx';
import type { CollectionView, ItemView } from '../../types.ts';
import { ItemSheet } from './ItemSheet.tsx';

// An agent asks with options (otea ask --option): the person answers with one tap on an option,
// with their own words below, or by leaving the decision to the agent.

const bug = officialType('bug-triage');
const errores = {
  name: 'Errores',
  prefix: 'ERR',
  preset: 'bug-triage',
  types: [bug],
} as unknown as CollectionView;

const asking = (asks: Partial<NonNullable<ItemView['asks']>> = {}): ItemView => ({
  id: 'ERR-214',
  collection: 'Errores',
  type: bug.name,
  title: 'Los lobos no cruzan el puente',
  fields: { severity: 'high', category: 'gameplay' },
  presetVersion: 3,
  state: 'fixing',
  turn: 'human',
  asks: { question: 1, by: 'Scout', text: '¿Arreglo también el río?', at: ago(5), ...asks },
  createdAt: ago(900),
  updatedAt: ago(5),
  createdBy: { kind: 'agent', name: 'Scout' },
  lease: null,
  events: [],
  transitions: [],
  relayable: [],
  missing: [],
  evidence: [],
  relations: [],
});

let page: Mounted | undefined;
let given: AnswerGiven[];
// What the server refuses the answer with, when a test has it refuse.
let refusal: Error | undefined;

beforeEach(() => {
  refusal = undefined;
  setLanguage('es');
  stubServer();
  window.localStorage.clear();
  given = [];
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setLanguage('en');
});

const app: App = testApp({
  collections: [errores],
  answer: async (_id, answer) => {
    given.push(answer);
    if (refusal) throw refusal;
  },
});

const open = (item: ItemView) => {
  page = mount(
    <AppTestProvider value={app}>
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

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.qa .opts .opt')];

describe('a question with options', () => {
  const offered = {
    options: ['Sí, también el río', 'Solo el puente', 'Déjalo así'],
    recommended: 2,
  };

  it('shows the options as buttons with the recommended one marked, and a box for your own words', () => {
    const root = open(asking(offered));

    expect(rows(root).map((row) => row.textContent)).toEqual([
      'Sí, también el río',
      'Solo el puente · recomendada',
      'Déjalo así',
    ]);
    expect(root.querySelector('.qa textarea')).not.toBeNull();
    expect(buttonNamed(root, 'Decide tú')).toBeDefined();
  });

  it('answers with one tap on an option, by its number', async () => {
    const root = open(asking(offered));

    await press(rows(root)[2]);

    // It says which question the tap is for: the page may be showing one that has since changed.
    expect(given).toEqual([{ question: 1, option: 3 }]);
  });

  it('says when the question changed under it, and sends nothing more', async () => {
    refusal = new Error(t('refusal.questionChanged'));
    const root = open(asking(offered));

    await press(rows(root)[0]);

    expect(root.querySelector('.said.warn')?.textContent).toBe(
      'Esta pregunta ya cambió. Mira la nueva y respóndela.',
    );
    expect(given).toHaveLength(1);
  });

  it('answers with your own words, typed below the options', async () => {
    const root = open(asking(offered));

    await typeInto(root.querySelector('.qa textarea'), 'Solo si es rápido');
    await press(buttonNamed(root, 'Enviar respuesta'));

    expect(given).toEqual([{ question: 1, text: 'Solo si es rápido' }]);
  });

  it('leaves the decision to the agent, with or without options', async () => {
    await press(buttonNamed(open(asking(offered)), 'Decide tú'));
    page?.unmount();
    await press(buttonNamed(open(asking()), 'Decide tú'));

    expect(given).toEqual([
      { question: 1, delegate: true },
      { question: 1, delegate: true },
    ]);
  });

  it('keeps a question with no options to words and the decision left to the agent', () => {
    const root = open(asking());

    expect(root.querySelector('.qa .opts')).toBeNull();
    expect(root.querySelector('.qa textarea')).not.toBeNull();
    expect(buttonNamed(root, 'Decide tú')).toBeDefined();
  });
});
