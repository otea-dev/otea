import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import { PrefsBody } from './Preferences.tsx';
import { PreferencesView } from './PreferencesView.tsx';
import { renderIn, testApp } from './test-app.ts';

afterEach(() => setLanguage('en'));

const app = (canManageDevices = true) =>
  testApp({ session: { canWrite: true, canConfigure: true, canManageDevices } });

const body = () => {
  setLanguage('es');
  return renderIn(app(), createElement(PrefsBody, { onMore: () => undefined }));
};

const page = (canManageDevices = true) => {
  setLanguage('es');
  return renderIn(
    app(canManageDevices),
    createElement(PreferencesView, { server: '127.0.0.1:4615' }),
  );
};

describe('the Preferences pop', () => {
  it('offers each quick choice as a segmented switch, the current one checked', () => {
    const html = body();
    expect(html).toMatch(/role="radio" aria-checked="true" class="on">.*Sistema/);
    for (const word of ['Claro', 'Oscuro', 'Completo', 'Reducido', 'English', 'Español']) {
      expect(html).toContain(word);
    }
    expect(html).toContain('Auto · ');
    expect(html).not.toContain('Plegar');
    expect(html).not.toContain('Deslizar');
  });

  it('says what the motion choice does and that only the interface is translated', () => {
    const html = body();
    expect(html).toContain('Sigue al sistema: ahora <b>completo</b>.');
    expect(html).toContain(
      '<b>Solo se traduce la interfaz.</b> Cada tablero conserva el idioma en que se hizo',
    );
  });

  it('stays small: the rest is on the page, one entry away', () => {
    const html = body();
    expect(html).toContain('Todas las preferencias…');
    for (const gone of ['Teléfono, en Configuración…', 'servidor', 'sesión', 'acerca de']) {
      expect(html).not.toContain(gone);
    }
  });
});

describe('the Preferences page', () => {
  it('says whose it is, against the project’s Configuración', () => {
    const html = page();
    expect(html).toContain('<h1 class="display">Preferencias</h1>');
    expect(html).toContain('<b>Tú</b>');
    expect(html).toContain('Lo del proyecto está en Configuración.');
  });

  it('gives each group its own heading, the quick choices among them', () => {
    const html = page();
    expect(html).toContain('<h2>Apariencia</h2>');
    expect(html).toContain('<h2>Acerca de</h2>');
    for (const word of ['Claro', 'Oscuro', 'Completo', 'Reducido', 'English']) {
      expect(html).toContain(word);
    }
  });

  it('leads to Configuración › Teléfono only where this browser may, and names the server', () => {
    expect(page()).toContain('Teléfono, en Configuración…');
    expect(page()).toContain('<h2>Sesión</h2>');
    expect(page(false)).not.toContain('Teléfono, en Configuración…');
    expect(page(false)).not.toContain('<h2>Sesión</h2>');
    expect(page()).toContain('<dt>servidor</dt><dd>127.0.0.1:4615</dd>');
  });
});
