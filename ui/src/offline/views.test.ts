import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import type { QueuedCapture } from './capture-queue.ts';
import { InstallBannerView } from './InstallBanner.tsx';
import { InstallLine, installLineWanted } from './InstallHint.tsx';
import { downWords, OfflineBar, syncedTime } from './OfflineBar.tsx';
import { QueuedCaptures } from './QueuedCaptures.tsx';

afterEach(() => setLanguage('en'));

const at = (h: number, m: number, day = 13) => new Date(2026, 10, day, h, m).getTime();

describe('the offline line', () => {
  it('says the PC does not answer, since when, and that it is read-only', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(OfflineBar, {
        sync: { offline: true, syncedAt: at(14, 32) },
        now: at(15, 0),
        host: 'desk.tail1.ts.net',
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('<b>Sin conexión</b>');
    expect(html).toContain('última sincronización 14:32');
    expect(html).toContain('solo lectura');
  });

  it('is gone while the PC answers', () => {
    const html = renderToStaticMarkup(
      createElement(OfflineBar, { sync: { offline: false, syncedAt: 1 }, now: 2, host: 'x' }),
    );
    expect(html).toBe('');
  });

  it('gives the hour alone for today, with the day otherwise', () => {
    expect(syncedTime(at(9, 5), at(23, 0), 'es')).toBe('09:05');
    expect(syncedTime(at(9, 5, 12), at(10, 0), 'en')).toMatch(/Nov 12.*09:05|12 Nov.*09:05/);
  });

  // One word for being offline, whatever the cause (field study 5: «No llego a tu equipo», «Otea no
  // responde» and «Sin conexión con tu equipo» on one screen); the cause is what follows it.
  it('says one thing for every cause, and the cause after it', () => {
    setLanguage('es');
    const heads = [
      downWords('localhost'),
      downWords('desk.tail1.ts.net', true),
      downWords('192.168.1.24', true),
      downWords('desk.tail1.ts.net', true, true),
    ].map(({ head }) => head);
    expect(new Set(heads)).toEqual(new Set(['Sin conexión']));
    setLanguage('en');
    expect(downWords('desk.tail1.ts.net', true).head).toBe('No connection');
  });

  it('on this computer it is Otea that does not answer', () => {
    setLanguage('es');
    expect(downWords('localhost')).toEqual({
      head: 'Sin conexión',
      ask: 'Otea no responde en este equipo.',
      local: true,
    });
  });

  it('through Tailscale it asks whether Tailscale is connected on the phone and Otea is open', () => {
    setLanguage('es');
    expect(downWords('desk.tail1.ts.net', true)).toEqual({
      head: 'Sin conexión',
      ask: '¿Tailscale está conectado en este teléfono? ¿Otea está abierto en tu equipo?',
      local: false,
    });
    // The origin says it, whatever the screen.
    expect(downWords('Desk.Tail1.TS.NET').ask).toContain('Tailscale');
  });

  it('on the local network it asks about the wifi instead', () => {
    setLanguage('es');
    for (const host of ['192.168.1.24', 'desk.local', 'localhost']) {
      expect(downWords(host, true)).toEqual({
        head: 'Sin conexión',
        ask: '¿Este teléfono está en la misma wifi que tu equipo? ¿Otea está abierto en tu equipo?',
        local: false,
      });
    }
    expect(downWords('192.168.1.24').ask).toContain('wifi');
  });

  // TS-11: Tailscale answered 502, so the phone reaches the PC and Otea is what is closed there.
  it('says Otea is not open on the computer when the door answers with nothing behind it', () => {
    setLanguage('es');
    expect(downWords('desk.tail1.ts.net', true, true)).toEqual({
      head: 'Sin conexión',
      ask: 'Otea no está abierto en tu equipo. Ábrelo allí: la app de escritorio u otea serve.',
      local: false,
    });
    setLanguage('en');
    expect(downWords('desk.tail1.ts.net', true, true).ask).toContain(
      'Otea is not open on your computer.',
    );
  });

  // TS-5: never an empty Te toca that looks like nothing waits.
  it('says when this phone has nothing saved yet', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(OfflineBar, {
        sync: { offline: true, syncedAt: null },
        now: 1,
        host: 'desk.tail1.ts.net',
        phone: true,
      }),
    );
    expect(html).toContain('este teléfono todavía no guardó nada de este proyecto');
  });

  // TS-6: the queue exists, so the line says what Nuevo does offline.
  it('says new items wait in the queue where the app keeps one', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(OfflineBar, {
        sync: { offline: true, syncedAt: 1 },
        now: 2,
        host: 'desk.tail1.ts.net',
        phone: true,
        queues: true,
      }),
    );
    expect(html).toContain('solo lectura · lo que captures queda en cola');
  });

  it('offers Reintentar, which tries the PC again', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(OfflineBar, {
        sync: { offline: true, syncedAt: null },
        now: 1,
        host: 'desk.tail1.ts.net',
        phone: true,
        onRetry: () => {},
      }),
    );
    expect(html).toMatch(/<button[^>]*class="ob-retry"[^>]*>Reintentar<\/button>/);
    expect(html).toContain('¿Tailscale está conectado en este teléfono?');
    setLanguage('en');
    const en = renderToStaticMarkup(
      createElement(OfflineBar, {
        sync: { offline: true, syncedAt: null },
        now: 1,
        host: 'desk.tail1.ts.net',
        phone: true,
        onRetry: () => {},
      }),
    );
    expect(en).toContain('<b>No connection</b>');
    expect(en).toContain('>Retry</button>');
  });
});

const queued = (o: Partial<QueuedCapture> = {}): QueuedCapture => ({
  id: 'cap-1',
  at: 1,
  board: 'Pedidos',
  type: 'request',
  fields: { title: 'Revisar la niebla' },
  ...o,
});

describe('the queue in Te toca', () => {
  it('lists each capture with its board, "en cola"', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(QueuedCaptures, { captures: [queued()], onDiscard: () => {} }),
    );

    expect(html).toContain('En cola');
    expect(html).toContain('Revisar la niebla');
    expect(html).toMatch(/Pedidos ·.*en cola/s);
    expect(html).not.toContain('Descartar');
  });

  it('keeps one the PC refused, with its words and Descartar', () => {
    setLanguage('es');
    const html = renderToStaticMarkup(
      createElement(QueuedCaptures, {
        captures: [queued({ refused: 'Board "Pedidos" not found' })],
        onDiscard: () => {},
      }),
    );

    expect(html).toContain('no se envió: Board &quot;Pedidos&quot; not found');
    expect(html).toContain('Descartar');
  });

  it('shows nothing with nothing queued', () => {
    expect(
      renderToStaticMarkup(createElement(QueuedCaptures, { captures: [], onDiscard: () => {} })),
    ).toBe('');
  });
});

// P7-F3: when Instalar finds no browser prompt, the banner stays and says how to do it by hand.
describe('the install banner', () => {
  const banner = (props: { offer: 'prompt' | 'android'; manual?: boolean }) =>
    renderToStaticMarkup(
      createElement(InstallBannerView, { onInstall: () => {}, onDismiss: () => {}, ...props }),
    );

  it('offers Install with the browser prompt behind it', () => {
    const html = banner({ offer: 'prompt' });
    expect(html).toContain('>Install<');
    expect(html).not.toContain('role="status"');
  });

  it('says it cannot install in one tap and gives the steps, with no dead button', () => {
    const html = banner({ offer: 'android', manual: true });
    expect(html).toContain('role="status"');
    expect(html).toContain('install it with one tap here. Do it by hand:');
    expect(html).toContain('Add to Home screen');
    expect(html).not.toContain('>Install<');
  });
});

describe('the install line in Preferencias', () => {
  const line = (platform: 'ios' | 'android' | 'other', prompt = false, offline = true) =>
    renderToStaticMarkup(
      createElement(InstallLine, { platform, prompt, offline, onPrompt: () => {} }),
    );

  // Dismissed on first open, the banner never comes back: Preferencias is where it is offered again,
  // over the LAN too, but promising the offline app only over HTTPS.
  it('offers it on the local network too, without promising it opens with the PC off', () => {
    setLanguage('es');
    const html = line('android', false, false);

    expect(html).toContain('Agregar a la pantalla de inicio');
    expect(html).not.toContain('se abre aunque tu equipo esté apagado');
  });

  it('belongs on a phone in the browser, never in the installed app or on the desk', () => {
    expect(installLineWanted({ phone: true, standalone: false })).toBe(true);
    expect(installLineWanted({ phone: true, standalone: true })).toBe(false);
    expect(installLineWanted({ phone: false, standalone: false })).toBe(false);
  });

  it('on iOS, says it is in Safari’s Share menu', () => {
    setLanguage('es');
    const html = line('ios');

    expect(html).toContain('Agregar a la pantalla de inicio');
    expect(html).toContain('En Safari: Compartir › Agregar a inicio.');
    expect(html).toContain('se abre aunque tu equipo esté apagado y se actualiza sola');
  });

  it('on Android, a button when the browser offers its prompt, the menu otherwise', () => {
    expect(line('android', true)).toMatch(/<button[^>]*>.*Add to Home Screen/s);
    expect(line('android')).toContain('In Chrome: menu (⋮) › Add to Home screen.');
  });
});
