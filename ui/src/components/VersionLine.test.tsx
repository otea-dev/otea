// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, AppTestProvider } from '../app/context.tsx';
import { setLanguage } from '../i18n/i18n.ts';
import { type Mounted, mount, press, settle, stubServer } from '../test-dom.tsx';
import { VersionLine } from './VersionLine.tsx';

let page: Mounted | undefined;
afterEach(() => {
  page?.unmount();
  page = undefined;
  vi.unstubAllGlobals();
  delete (window as { oteaDesktopPrefs?: unknown }).oteaDesktopPrefs;
  setLanguage('en');
});

// The line as the page draws it, over a server that runs `server` (and answers nothing when it is
// undefined), in a page built as `built`.
async function shown(server: string | undefined, built: string, phone = false) {
  stubServer((path) =>
    path.endsWith('/api/version') && server ? { version: server, platform: 'linux' } : undefined,
  );
  const app = { connection: 'live', phone } as unknown as App;
  page = mount(
    <AppTestProvider value={app}>
      <VersionLine page={built} />
    </AppTestProvider>,
  );
  await settle();
  return page.root;
}

// The clipboard, as a browser lends it: what was copied is what was last written.
function clipboard(): string[] {
  const written: string[] = [];
  vi.stubGlobal('navigator', {
    ...navigator,
    platform: 'TestOS',
    clipboard: { writeText: async (text: string) => void written.push(text) },
  });
  return written;
}

describe('the version line', () => {
  it('names the version the server runs, whatever the page was built as', async () => {
    expect((await shown('7.7.7', '7.7.7')).textContent).toContain('Otea7.7.7');
    page?.unmount();
    expect((await shown('12.0.1', '12.0.1')).textContent).toContain('Otea12.0.1');
  });

  it('shows nothing until the server has said which Otea it is', async () => {
    expect((await shown(undefined, '1.0.0')).textContent).toBe('');
  });

  it('says in plain words that the page is not the server’s version, and not otherwise', async () => {
    const stale = await shown('0.4.0', '0.3.9');
    expect(stale.querySelector('[role="status"]')?.textContent).toContain(
      'This page is Otea 0.3.9, but the server runs 0.4.0. Reload it',
    );
    page?.unmount();
    expect((await shown('0.4.0', '0.4.0')).querySelector('[role="status"]')).toBeNull();
  });

  it('copies the version, the system and the browser for a report', async () => {
    const written = clipboard();
    const root = await shown('0.4.0', '0.4.0');
    await press(root.querySelector('button'));
    expect(written).toEqual(['Otea 0.4.0 · page 0.4.0 · server on linux · browser on TestOS']);
  });

  it('adds the desktop app’s own version when the page runs inside it', async () => {
    (window as { oteaDesktopPrefs?: unknown }).oteaDesktopPrefs = {
      appVersion: async () => '0.4.2',
    };
    const written = clipboard();
    const root = await shown('0.4.0', '0.4.0');
    await press(root.querySelector('button'));
    expect(written[0]).toContain('desktop app 0.4.2 on TestOS');
  });

  it('says a phone when the page is the phone’s', async () => {
    const written = clipboard();
    const root = await shown('0.4.0', '0.4.0', true);
    await press(root.querySelector('button'));
    expect(written[0]).toContain('phone browser on TestOS');
  });
});
