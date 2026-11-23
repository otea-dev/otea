// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { buttonNamed, mount, press, typeInto } from '../test-dom.tsx';
import { SignedOutGate } from './SignedOut.tsx';

// P8-F4: with the sign-in gone the desk must say so and show the way back in, never an empty
// «Nada espera por ti» with «Sin conexión». And what was being typed survives the page.

const retry = vi.fn();
const app = (over: Partial<App>) =>
  ({ sync: { offline: false, syncedAt: 1 }, retry, phone: false, ...over }) as unknown as App;

beforeEach(() => {
  setLanguage('es');
  retry.mockClear();
});
afterEach(() => vi.restoreAllMocks());

function show(over: Partial<App>) {
  return mount(
    <AppTestProvider value={app(over)}>
      <SignedOutGate>
        <p>El escritorio</p>
      </SignedOutGate>
    </AppTestProvider>,
  );
}

// The page can be toggled from outside the gate, with a field inside it.
function Harness() {
  const [out, setOut] = useState(false);
  const sync = { offline: false, syncedAt: 1, signedOut: true as const };
  return (
    <>
      <button type="button" onClick={() => setOut((was) => !was)}>
        toggle
      </button>
      <AppTestProvider value={app(out ? { sync } : {})}>
        <SignedOutGate>
          <input aria-label="nota" />
        </SignedOutGate>
      </AppTestProvider>
    </>
  );
}

const shown = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.signed-out-app')?.style.display !== 'none';

describe('the app without its sign-in', () => {
  it('shows the app while the sign-in holds', () => {
    const view = show({});
    expect(shown(view.root)).toBe(true);
    expect(view.root.querySelector('.signed-out')).toBeNull();
    view.unmount();
  });

  it('says the session ran out in place of the app, with the command and a retry', async () => {
    const view = show({ sync: { offline: false, syncedAt: 1, signedOut: true } });
    expect(shown(view.root)).toBe(false);
    expect(view.root.querySelector('.signed-out')?.textContent).toContain('Tu sesión caducó');
    expect(view.root.querySelector('.pj-cmd code')?.textContent).toBe('otea open');
    await press(buttonNamed(view.root, 'Volver a intentar'));
    expect(retry).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('says the same on a narrow window, with the desktop app’s line and no phone line', () => {
    const view = show({ phone: true, sync: { offline: false, syncedAt: 1, signedOut: true } });
    const page = view.root.querySelector('.signed-out')?.textContent ?? '';
    expect(page).toContain('Tu sesión caducó');
    expect(page).toContain('app de escritorio');
    expect(page).not.toContain('emparejado');
    view.unmount();
  });

  it('keeps what was being typed when the page comes and goes', async () => {
    const view = mount(<Harness />);
    const field = () => view.root.querySelector<HTMLInputElement>('input[aria-label=nota]');
    await typeInto(field(), 'una nota a medias');
    const before = field();
    await press(buttonNamed(view.root, 'toggle'));
    expect(shown(view.root)).toBe(false);
    await press(buttonNamed(view.root, 'toggle'));
    expect(field()).toBe(before);
    expect(field()?.value).toBe('una nota a medias');
    view.unmount();
  });
});
