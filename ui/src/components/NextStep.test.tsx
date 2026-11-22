// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTestProvider } from '../app/context.tsx';
import { item } from '../derive/fixtures.ts';
import { setLanguage } from '../i18n/i18n.ts';
import { testApp } from '../shell/test-app.ts';
import { buttonNamed, type Mounted, mount, press } from '../test-dom.tsx';
import type { Item } from '../types.ts';
import { NextStep } from './NextStep.tsx';

// After a project's first finished item nothing said what comes next: a calm card does, once per
// project, and a press of «Ahora no» (or of anything it offers) puts it away for good.

const closed = (id: string): Item => ({
  ...item({ id, state: 'done', turn: 'none' }),
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

  beforeEach(() => {
    window.localStorage.clear();
    setLanguage('es');
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    setLanguage('en');
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
