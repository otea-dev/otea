// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../../app/context.tsx';
import { workspace } from '../../app/workspace.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import { testApp } from '../../shell/test-app.ts';
import { type Mounted, mount, settle, stubServer } from '../../test-dom.tsx';
import { DetailHost } from './DetailHost.tsx';

// Field study s-real (D-c951c9, D-7f0697): an item opened beside a list and made full (Ampliar)
// dims the list under it; closing the item while it was full left the list at no opacity, so the
// board or Te toca came back as dots on a blank page.

let page: Mounted | undefined;

beforeEach(() => {
  setLanguage('en');
  stubServer(() => ({ name: 'quill', agent: null }));
});
afterEach(() => {
  page?.unmount();
  page = undefined;
  workspace.set({ agent: null, full: false });
  vi.unstubAllGlobals();
});

// The list holds at no opacity (fill: forwards) for as long as the sheet is full.
const dimmed = (view: Element) => view.getAnimations().some((a) => a.id === 'dim');

describe('closing an item that was made full', () => {
  it('gives the list under it back, never left dim', async () => {
    page = mount(
      <AppTestProvider value={testApp()}>
        <div className="main">
          <section className="view" />
          <DetailHost />
        </div>
      </AppTestProvider>,
    );
    const view = page.root.querySelector('.view') as HTMLElement;
    await act(async () => workspace.set({ agent: 'quill' }));
    await settle();
    await act(async () => workspace.set({ full: true }));
    await settle();
    expect(dimmed(view)).toBe(true);

    await act(async () => workspace.set({ agent: null }));
    await vi.waitFor(() => expect(page?.root.querySelector('.sheet')).toBeNull(), {
      timeout: 3000,
    });
    expect(dimmed(view)).toBe(false);
  });
});
