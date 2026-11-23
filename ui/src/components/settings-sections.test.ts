import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/i18n.ts';
import type { ProjectSettings } from '../types.ts';
import { SettingsBody } from './ProjectSettings.tsx';

// P4-F2: Configuración mixed what a person changes with what only a technician reads. It is now
// four sections (Tú, Este proyecto, Teléfono, Avanzado), and the commands, the repos and the git
// hook live behind «Detalles técnicos».

afterEach(() => setLanguage('en'));

const value = {
  id: 'pendientes-obvry2',
  name: 'Pendientes',
  storage: 'common',
  root: 'D:/p/Pendientes',
  dataDir: 'D:/home/data/pendientes',
  registered: true,
  database: { path: 'D:/home/data/pendientes/otea.db', bytes: 4096 },
  evidence: { path: 'D:/home/data/pendientes/evidence', bytes: 0, files: 0 },
  items: 3,
  collections: [],
  paths: [
    {
      path: 'D:/p/Pendientes',
      kind: 'folder',
      missing: false,
      repos: [{ name: 'web', folder: 'web', gate: 'hard', items: 3, remote: true }],
    },
  ],
} as unknown as ProjectSettings;

const render = (override: Partial<ProjectSettings> = {}, canWrite = true) =>
  renderToStaticMarkup(
    createElement(SettingsBody, {
      value: { ...value, ...override },
      canWrite,
      onChanged: () => {},
      onPreferences: () => {},
      you: createElement('p', null, 'YOU-PANEL'),
      phone: createElement('p', null, 'PHONE-PANEL'),
    }),
  );

const headings = (html: string) =>
  [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => match[1]);

// Splits the page at the technical disclosure: what a person reads, and what is behind it.
const split = (html: string) => {
  const at = html.indexOf('<details class="tech">');
  return { plain: html.slice(0, at), tech: html.slice(at) };
};

const JARGON = ['--join', '--to', 'tailnet', 'pre-push', 'otea projects add', 'otea migrate'];

describe('Configuración in sections', () => {
  it('reads Tú, Este proyecto, Teléfono and Avanzado, in that order', () => {
    setLanguage('es');
    expect(headings(render())).toEqual(['Tú', 'Este proyecto', 'Teléfono', 'Avanzado']);
    setLanguage('en');
    expect(headings(render())).toEqual(['You', 'This project', 'Phone', 'Advanced']);
  });

  it('keeps commands, flags and the git hook behind Detalles técnicos, in both languages', () => {
    for (const language of ['es', 'en'] as const) {
      setLanguage(language);
      const { plain, tech } = split(render());
      for (const word of JARGON) expect(plain, `${language}: ${word}`).not.toContain(word);
      expect(tech).toContain('--join');
      expect(tech).toContain('otea projects add . --to Pendientes');
      expect(tech).toContain('pendientes-obvry2');
      expect(tech).toContain('pre-push');
    }
  });

  it('keeps the person’s own choices in the first section and the repos table out of sight', () => {
    setLanguage('es');
    const { plain, tech } = split(render());
    expect(plain).toContain('YOU-PANEL');
    expect(plain).toContain('PHONE-PANEL');
    expect(plain).toContain('Agregar una carpeta…');
    expect(plain).not.toContain('class="pj-repos"');
    expect(tech).toContain('class="pj-repos"');
  });

  it('says a local project’s limit plainly and leaves its command for Avanzado', () => {
    setLanguage('es');
    const { plain, tech } = split(render({ registered: false }));
    expect(plain).toContain('Este proyecto vive en una sola carpeta');
    expect(plain).not.toContain('otea migrate');
    expect(tech).toContain('otea migrate --to common');
  });
});
