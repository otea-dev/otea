// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { buttonNamed, mount, press } from '../test-dom.tsx';
import { SignedOutGate } from './SignedOut.tsx';

// P8-F4: with the sign-in gone the desk must say so and show the way back in, never an empty
// «Nada espera por ti» with «Sin conexión».

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

describe('the app without its sign-in', () => {
  it('shows the app while the sign-in holds', () => {
    const view = show({});
    expect(view.root.textContent).toContain('El escritorio');
    expect(view.root.textContent).not.toContain('sesión');
    view.unmount();
  });

  it('says the session ran out in place of the app, with the command and a retry', async () => {
    const view = show({ sync: { offline: false, syncedAt: 1, signedOut: true } });
    const text = view.root.textContent ?? '';
    expect(text).not.toContain('El escritorio');
    expect(text).toContain('Tu sesión caducó');
    expect(view.root.querySelector('.pj-cmd code')?.textContent).toBe('otea open');
    await press(buttonNamed(view.root, 'Volver a intentar'));
    expect(retry).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('says the same on a phone, and how a paired phone gets back in', () => {
    const view = show({ phone: true, sync: { offline: false, syncedAt: 1, signedOut: true } });
    expect(view.root.textContent).toContain('Tu sesión caducó');
    expect(view.root.textContent).toContain('Configuración › Teléfono');
    view.unmount();
  });
});
