import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardRecord } from '../app/boards.ts';
import type { Project } from '../app/project.ts';
import { LANGUAGE_HEADER } from '../core/board/template-words.ts';
import { findVersion } from '../store/boards.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// The desk says the language on its screen with every request, and a board made in Spanish comes
// back in it: in Spanish for a Spanish desk and in English for an English one, one stored board.
describe('a board read by desks in two languages', () => {
  let project: Project;
  let server: OteaServer;

  const call = async (method: string, path: string, payload?: unknown, lang?: string) => {
    const response = await server.app.request(`/p/memory-aaaaaa/api${path}`, {
      method,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      headers: {
        host: LOCAL_HOST,
        origin: `http://${LOCAL_HOST}`,
        cookie: SESSION_COOKIE,
        'content-type': 'application/json',
        ...(lang === undefined ? {} : { [LANGUAGE_HEADER]: lang }),
      },
    });
    // A board reads as { record, problems }; a board written as the record itself.
    return {
      status: response.status,
      body: (await response.json()) as BoardRecord & { record: BoardRecord },
    };
  };

  beforeEach(() => {
    project = memoryProject();
    server = createServer(project, { token: TOKEN });
  });

  afterEach(() => {
    server.close();
    project.db.close();
  });

  it('says the steps and fields in the language each desk sends, from one stored board', async () => {
    const made = await call('POST', '/boards', {
      name: 'Errores',
      lang: 'es',
      template: 'bug-reports',
    });
    expect(made.status).toBe(201);
    const { id } = made.body;
    const published = await call('POST', `/boards/${id}/publish`, { moves: {} });
    expect(published.status).toBe(200);
    const stored = findVersion(project.db, id, 1)?.definition;

    const names = async (lang?: string) => {
      const { record } = (await call('GET', `/boards/${id}`, undefined, lang)).body;
      const def = record.live?.definition;
      return {
        steps: def?.steps.map(({ name }) => name),
        parts: Object.values(def?.parts ?? {}).map(({ name }) => name),
      };
    };
    const spanish = await names('es');
    const english = await names('en');
    expect(spanish.steps).toEqual(['Completar', 'Triar', 'Arreglar', 'Integrar']);
    expect(spanish.parts).toContain('Lo que reportaron');
    expect(english.steps).toEqual(['Complete', 'Triage', 'Fix', 'Land']);
    expect(english.parts).toContain('What they reported');
    // A desk that says nothing is read in the language it last told the server, else as made.
    expect((await names()).steps).toEqual(spanish.steps);
    await call('POST', '/language', { lang: 'en' });
    expect((await names()).steps).toEqual(english.steps);
    // Nothing of it changed what is stored.
    expect(findVersion(project.db, id, 1)?.definition).toBe(stored);
  });

  // The editor opens a draft in Spanish, the person switches the desk to English, and the editor's
  // autosave sends the Spanish words it holds under an English header: the server reconciles
  // against the language the draft was read in (`readIn`), not the one the request says, so the
  // snapshot survives and the draft still reads in both languages.
  it('keeps the snapshot when the desk switches language under an open editor', async () => {
    const made = await call('POST', '/boards', {
      name: 'Errores',
      lang: 'es',
      template: 'bug-reports',
    });
    const { id } = made.body;
    const opened = (await call('GET', `/boards/${id}`, undefined, 'es')).body.record;
    const draft = opened.draft?.definition;
    const [first] = draft?.steps ?? [];
    if (!draft || !first) throw new Error('no draft');
    expect(first.name).toBe('Completar');

    // The edit made after the switch: the second step's name, typed in Spanish.
    const second = draft.steps[1];
    if (!second) throw new Error('no second step');
    second.name = 'Mirar a ojo';
    const autosaved = await call(
      'PUT',
      `/boards/${id}/draft`,
      { definition: draft, baseVersion: null, readIn: 'es' },
      'en',
    );
    expect(autosaved.status).toBe(200);

    const stepsIn = async (lang: string) =>
      (await call('GET', `/boards/${id}`, undefined, lang)).body.record.draft?.definition.steps.map(
        ({ name }) => name,
      );
    // What was not touched still follows the language; the edit is the person's in both.
    expect(await stepsIn('en')).toEqual(['Complete', 'Mirar a ojo', 'Fix', 'Land']);
    expect(await stepsIn('es')).toEqual(['Completar', 'Mirar a ojo', 'Arreglar', 'Integrar']);
  });

  // A save that does not say the language it was read in would be reconciled against the desk's
  // today, which strips the snapshot after a switch: it is refused, never guessed.
  it('refuses a draft save that does not say the language it was read in', async () => {
    const made = await call('POST', '/boards', {
      name: 'Errores',
      lang: 'es',
      template: 'bug-reports',
    });
    const { id } = made.body;
    const draft = made.body.draft?.definition;
    if (!draft) throw new Error('the board has no draft');

    const refused = await call(
      'PUT',
      `/boards/${id}/draft`,
      { definition: draft, baseVersion: null },
      'en',
    );
    expect(refused.status).toBe(400);
    const wrong = await call(
      'PUT',
      `/boards/${id}/draft`,
      { definition: draft, baseVersion: null, readIn: 'xx' },
      'en',
    );
    expect(wrong.status).toBe(400);
    // Nothing was saved over the draft.
    expect(
      (await call('GET', `/boards/${id}`, undefined, 'es')).body.record.draft?.definition.steps[0]
        ?.name,
    ).toBe('Completar');
  });

  it('keeps the words a person wrote when the desk switches language', async () => {
    const made = await call('POST', '/boards', {
      name: 'Errores',
      lang: 'es',
      template: 'bug-reports',
    });
    const { id } = made.body;
    const draft = made.body.draft?.definition;
    if (!draft) throw new Error('the board has no draft');
    const [first] = draft.steps;
    if (!first) throw new Error('no step');
    first.name = 'Revisar a mano';
    const saved = await call(
      'PUT',
      `/boards/${id}/draft`,
      { definition: draft, baseVersion: null, readIn: 'es' },
      'es',
    );
    expect(saved.status).toBe(200);

    const english = await call('GET', `/boards/${id}`, undefined, 'en');
    expect(english.body.record.draft?.definition.steps.map(({ name }) => name)).toEqual([
      'Revisar a mano',
      'Triage',
      'Fix',
      'Land',
    ]);
  });

  it('answers desks in two languages at once, each in its own, and says the answer depends on it', async () => {
    const made = await call('POST', '/boards', {
      name: 'Errores',
      lang: 'es',
      template: 'bug-reports',
    });
    const { id } = made.body;
    const read = async (lang: string) => {
      const response = await server.app.request(`/p/memory-aaaaaa/api/boards/${id}`, {
        headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE, [LANGUAGE_HEADER]: lang },
      });
      const { record } = (await response.json()) as { record: BoardRecord };
      return { vary: response.headers.get('vary'), step: record.draft?.definition.steps[0]?.name };
    };

    const answers = await Promise.all(
      ['es', 'en', 'es', 'en', 'en', 'es'].map((lang) => read(lang)),
    );
    expect(answers.map(({ step }) => step)).toEqual([
      'Completar',
      'Complete',
      'Completar',
      'Complete',
      'Complete',
      'Completar',
    ]);
    expect(answers[0]?.vary?.toLowerCase()).toContain(LANGUAGE_HEADER);
  });
});
