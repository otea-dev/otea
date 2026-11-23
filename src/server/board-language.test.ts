import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardRecord } from '../app/boards.ts';
import type { Project } from '../app/project.ts';
import { findVersion } from '../store/boards.ts';
import { createServer, type OteaServer } from './server.ts';
import { LOCAL_HOST, memoryProject, SESSION_COOKIE, TOKEN } from './testing.ts';

// A board's own words (its steps, fields, options, item names) are read in the language the board
// was made in, which is the one the agent reads it in: whatever language the desk's screen is in,
// and whoever asks (the desk, the phone). The desk's screen language is for its own chrome.
describe('a board read by desks in two languages', () => {
  let project: Project;
  let server: OteaServer;

  // `screen` is what a desk of an older build sent as its screen language: it changes nothing.
  const call = async (method: string, path: string, payload?: unknown, screen?: string) => {
    const response = await server.app.request(`/p/memory-aaaaaa/api${path}`, {
      method,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      headers: {
        host: LOCAL_HOST,
        origin: `http://${LOCAL_HOST}`,
        cookie: SESSION_COOKIE,
        'content-type': 'application/json',
        ...(screen === undefined ? {} : { 'x-otea-lang': screen }),
      },
    });
    // A board reads as { record, problems }; a board written as the record itself.
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as BoardRecord & { record: BoardRecord },
    };
  };

  const made = async (lang: 'en' | 'es') => {
    const board = await call('POST', '/boards', {
      name: lang === 'en' ? 'Bugs' : 'Errores',
      lang,
      template: 'bug-reports',
    });
    expect(board.status).toBe(201);
    return board.body.id;
  };

  const namesOf = async (id: string, screen?: string) => {
    const { record } = (await call('GET', `/boards/${id}`, undefined, screen)).body;
    const def = record.draft?.definition ?? record.live?.definition;
    return {
      steps: def?.steps.map(({ name }) => name),
      parts: Object.values(def?.parts ?? {}).map(({ name }) => name),
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

  it('says an English board in English on a Spanish screen, and a Spanish one in Spanish on an English screen', async () => {
    const english = await made('en');
    const spanish = await made('es');

    for (const screen of ['es', 'en', undefined]) {
      const read = await namesOf(english, screen);
      expect(read.steps).toEqual(['Complete', 'Triage', 'Fix', 'Land']);
      expect(read.parts).toContain('What they reported');
    }
    for (const screen of ['es', 'en', undefined]) {
      const read = await namesOf(spanish, screen);
      expect(read.steps).toEqual(['Completar', 'Triar', 'Arreglar', 'Integrar']);
      expect(read.parts).toContain('Lo que reportaron');
    }
  });

  it('gives the desk the states of a published board in the words the agent reads, on every screen', async () => {
    const id = await made('en');
    expect((await call('POST', `/boards/${id}/publish`, { moves: {} })).status).toBe(200);
    const stored = findVersion(project.db, id, 1)?.definition;

    const labels = async (screen: string) => {
      const response = await server.app.request('/p/memory-aaaaaa/api/presets', {
        headers: { host: LOCAL_HOST, cookie: SESSION_COOKIE, 'x-otea-lang': screen },
      });
      const presets = (await response.json()) as {
        types: { labels?: Record<string, { states: Record<string, string> }> }[];
      }[];
      // The board's own preset is the one with a step "Triage" (the official ones have none).
      return presets
        .flatMap(({ types }) => types)
        .flatMap(({ labels: byLang }) =>
          Object.entries(byLang ?? {}).map(([lang, words]) => ({
            lang,
            states: Object.values(words.states),
          })),
        )
        .filter(({ states }) => states.includes('Triage'));
    };

    for (const screen of ['es', 'en']) {
      const found = await labels(screen);
      // The desk picks the labels of its own screen language; whichever it picks says the board's.
      expect(found.map(({ lang }) => lang).sort()).toEqual(['en', 'es']);
      for (const { states } of found) {
        expect(states).toContain('Triage');
        expect(states).not.toContain('Triar');
        expect(states).not.toContain('Arreglar');
      }
    }
    expect(findVersion(project.db, id, 1)?.definition).toBe(stored);
  });

  // The editor opens a draft on a Spanish screen and the person changes a step: the autosave must
  // keep what the template said in the other words. The editor reads, and saves, in the board's
  // language, so nothing the person did not touch is taken for a change.
  it('saves a draft keeping the template words the person did not touch', async () => {
    const id = await made('en');
    const draft = (await call('GET', `/boards/${id}`, undefined, 'es')).body.record.draft
      ?.definition;
    const second = draft?.steps[1];
    if (!draft || !second) throw new Error('no draft');
    expect(draft.snapshot).toBeDefined();
    const kept = Object.keys(draft.snapshot ?? {});
    second.name = 'Look at it';

    const saved = await call(
      'PUT',
      `/boards/${id}/draft`,
      { definition: draft, baseVersion: null },
      'es',
    );
    expect(saved.status).toBe(200);

    const after = (await call('GET', `/boards/${id}`, undefined, 'es')).body.record.draft
      ?.definition;
    expect(after?.steps.map(({ name }) => name)).toEqual(['Complete', 'Look at it', 'Fix', 'Land']);
    // Only the changed word lost its snapshot.
    expect(Object.keys(after?.snapshot ?? {}).sort()).toEqual(
      kept.filter((path) => path !== `steps.${second.id}.name`).sort(),
    );
  });

  // An editor tab opened before this release still sends the language it read the draft in. It must
  // keep saving, and what it says changes nothing.
  it('still takes the save of a tab that sends the language it read the draft in', async () => {
    const id = await made('en');
    const draft = (await call('GET', `/boards/${id}`)).body.record.draft?.definition;
    const first = draft?.steps[0];
    if (!draft || !first) throw new Error('no draft');
    first.name = 'Fill in';

    const saved = await call('PUT', `/boards/${id}/draft`, {
      definition: draft,
      baseVersion: null,
      readIn: 'es',
    });
    expect(saved.status).toBe(200);
    expect((await namesOf(id)).steps).toEqual(['Fill in', 'Triage', 'Fix', 'Land']);
  });

  it('answers the same whatever the screen, so nothing it caches depends on it', async () => {
    const id = await made('en');
    const a = await call('GET', `/boards/${id}`, undefined, 'es');
    const b = await call('GET', `/boards/${id}`, undefined, 'en');
    expect(a.body).toEqual(b.body);
    expect(a.headers.get('vary')?.toLowerCase() ?? '').not.toContain('x-otea-lang');
  });
});
