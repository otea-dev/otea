// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { loadBoards, resetBoards } from '../board-studio/home/boards-store.ts';
import { ago, item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press, stubServer } from '../test-dom.tsx';
import type { Item } from '../types.ts';
import { NextStep } from './NextStep.tsx';

// After a project's first finished item nothing said what comes next: a calm card does, once per
// project, and a press of «Ahora no» (or of anything it offers) puts it away for good.

// An item that reached the last step `days` days before the desk's now (a few minutes by default).
const closed = (id: string, days = 0): Item => ({
  ...item({ id, state: 'done', turn: 'none', enteredAt: ago(days * 1440 + 30) }),
  closes: 'done',
});
const open = item({ id: 'B-1', state: 'doing', turn: 'agent' });

const drawn = (project: string, items: Item[], extra: Parameters<typeof testApp>[0] = {}) =>
  mount(
    <AppTestProvider
      value={testApp({ project: { id: project, name: project, icon: null }, all: items, ...extra })}
    >
      <NextStep />
    </AppTestProvider>,
  );

describe('the next-step card', () => {
  let mounted: Mounted | undefined;

  // The project's boards are read first: Errores is the person's board, Pedidos the built-in one.
  beforeEach(async () => {
    window.localStorage.clear();
    setLanguage('es');
    resetBoards();
    stubServer((path) =>
      path.endsWith('/api/boards')
        ? {
            boards: [
              { id: 'b1', name: 'Errores', collection: 'Errores', builtin: false },
              { id: 'b2', name: 'Pedidos', collection: 'Pedidos', builtin: true },
            ],
          }
        : undefined,
    );
    loadBoards(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.unstubAllGlobals();
    setLanguage('en');
  });

  // Publishing a board an agent drafted closes its Pedido: that is the desk's own errand, not the
  // person's first finished item.
  it('does not count the request a board was drafted on', () => {
    const pedido: Item = { ...closed('REQ-1'), collection: 'Pedidos' };

    mounted = drawn('req', [pedido]);
    expect(mounted.root.textContent).toBe('');
    mounted.unmount();

    // The person's own work still brings it, whatever the Pedido did before.
    mounted = drawn('req2', [pedido, closed('A-1')]);
    expect(mounted.root.textContent).toContain('Tu primer ítem está terminado');
  });

  // The card leaves slowly: it is gone once its exit has run.
  const gone = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
  const buttonWith = (root: HTMLElement, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

  it('stays away until an item reaches its last step', () => {
    mounted = drawn('p1', [open]);

    expect(mounted.root.textContent).toBe('');
  });

  // On the release that brings the card, every project with finished work is an old one.
  it('is for a first finished item that is recent, not for a project that finished one long ago', () => {
    mounted = drawn('old', [closed('A-1', 30)]);
    expect(mounted.root.textContent).toBe('');
    mounted.unmount();

    // A recent item is not the project's first one when an older one came before.
    mounted = drawn('older', [closed('A-1', 30), closed('A-2')]);
    expect(mounted.root.textContent).toBe('');
    mounted.unmount();

    mounted = drawn('week', [closed('A-1', 6)]);
    expect(mounted.root.textContent).toContain('Tu primer ítem está terminado');
  });

  it('says it is remembered on this device', () => {
    mounted = drawn('p0', [closed('A-1')]);

    expect(mounted.root.textContent).toContain('No volverá a aparecer en este dispositivo');
  });

  it('shows once per project: put away, it never comes back, in that project', async () => {
    mounted = drawn('p1', [closed('A-1')]);
    expect(mounted.root.textContent).toContain('Tu primer ítem está terminado');
    expect(mounted.root.textContent).toContain('Emparejar tu teléfono');
    expect(mounted.root.textContent).toContain('Crear otro tablero');
    expect(mounted.root.textContent).toContain('Invitar a otro agente');

    await press(buttonNamed(mounted.root, 'Ahora no'));
    await gone();
    expect(mounted.root.textContent).toBe('');

    // Another open of the desk, and a second finished item: still gone.
    mounted.unmount();
    mounted = drawn('p1', [closed('A-1'), closed('A-2')]);
    expect(mounted.root.textContent).toBe('');

    // It is the project's, not the browser's: another project has its own.
    mounted.unmount();
    mounted = drawn('p2', [closed('B-1')]);
    expect(mounted.root.textContent).toContain('Tu primer ítem está terminado');
  });

  it('goes for good once a person takes one of the things it offers', async () => {
    const openConnect = vi.fn();
    mounted = drawn('p3', [closed('A-1')], { openConnect });

    await press(buttonWith(mounted.root, 'Invitar a otro agente'));
    expect(openConnect).toHaveBeenCalledTimes(1);
    await gone();
    mounted.unmount();

    mounted = drawn('p3', [closed('A-1')]);
    expect(mounted.root.textContent).toBe('');
  });

  it('offers no phone to pair where the desk cannot pair one', () => {
    mounted = drawn('p4', [closed('A-1')], {
      session: { canWrite: true, canConfigure: true, canManageDevices: false },
    });

    expect(mounted.root.textContent).not.toContain('Emparejar tu teléfono');
    expect(mounted.root.textContent).toContain('Invitar a otro agente');
  });
});
