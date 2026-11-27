// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import { mount, press } from '../test-dom.tsx';
import { OfflineBar } from './OfflineBar.tsx';

// Field study 5: on a phone the offline notice was a card (the cause, the wifi, since when, the
// queue, a button) that said what the pill, the secretary's line and the composer's note said. It is
// one quiet line, with the cause one tap away.

beforeEach(() => setLanguage('es'));
afterEach(() => setLanguage('en'));

const at = (h: number, m: number) => new Date(2026, 10, 13, h, m).getTime();

const bar = (props: Partial<Parameters<typeof OfflineBar>[0]> = {}) => (
  <OfflineBar
    sync={{ offline: true, syncedAt: at(16, 55) }}
    now={at(17, 10)}
    host="desk.tail1.ts.net"
    phone
    onRetry={() => undefined}
    {...props}
  />
);

describe('the offline line on the phone', () => {
  it('is one line: the word, the hour of the last sync and Reintentar', () => {
    const view = mount(bar());
    const line = view.root.querySelector('.ob-line');
    expect(line?.textContent).toContain('Sin conexión');
    expect(line?.textContent).toContain('16:55');
    expect(view.root.querySelector('.ob-retry')?.textContent).toBe('Reintentar');
    view.unmount();
  });

  it('keeps the cause and what still works behind a tap', async () => {
    const view = mount(bar({ queues: true }));
    const more = view.root.querySelector<HTMLElement>('.ob-more');
    // Closed: nothing of it shows (and a screen reader skips it).
    expect(more?.hidden).toBe(true);
    expect(view.root.querySelector('.ob-line')?.getAttribute('aria-expanded')).toBe('false');

    await press(view.root.querySelector('.ob-line'));
    expect(view.root.querySelector('.ob-line')?.getAttribute('aria-expanded')).toBe('true');
    expect(view.root.querySelector<HTMLElement>('.ob-more')?.hidden).toBe(false);
    expect(more?.textContent).toContain('¿Tailscale está conectado en este teléfono?');
    expect(more?.textContent).toContain('última sincronización 16:55');
    // Notes queue; a message to the secretary does not: the line says the first, never «en cola»
    // for what Hablar writes.
    expect(more?.textContent).toContain('solo lectura · lo que captures queda en cola');
    view.unmount();
  });

  it('says there is nothing saved on a phone that never synced, in place of an hour', () => {
    const view = mount(bar({ sync: { offline: true, syncedAt: null } }));
    expect(view.root.querySelector('.ob-line')?.textContent).toContain('sin datos');
    expect(view.root.querySelector('.ob-more')?.textContent).toContain(
      'este teléfono todavía no guardó nada de este proyecto',
    );
    view.unmount();
  });

  it('retries without opening the line', async () => {
    const retry = vi.fn();
    const view = mount(bar({ onRetry: retry }));
    await press(view.root.querySelector('.ob-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(view.root.querySelector('.ob-line')?.getAttribute('aria-expanded')).toBe('false');
    view.unmount();
  });

  it('is gone while the PC answers', () => {
    const view = mount(bar({ sync: { offline: false, syncedAt: 1 } }));
    expect(view.root.querySelector('.offline-bar')).toBeNull();
    view.unmount();
  });
});
