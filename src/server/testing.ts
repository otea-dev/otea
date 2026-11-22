import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Project } from '../app/project.ts';
import { memoryContext, projectOf } from '../app/testing.ts';
import type { Preset } from '../core/preset.ts';
import { openDatabase } from '../store/database.ts';
import type { OteaServer } from './server.ts';

export function memoryProject(...presets: Preset[]): Project {
  return projectOf('/memory', memoryContext(...presets));
}

export function tempDatabase(): { open: () => DatabaseSync; remove: () => void } {
  const path = join(tmpdir(), `otea-server-${randomUUID()}.db`);
  return {
    open: () => openDatabase(path),
    remove: () => {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    },
  };
}

export const LOCAL_HOST = '127.0.0.1:4400';

export const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuv';

export const SESSION_COOKIE = `otea_session_4400=${TOKEN}`;

// A read as this computer's signed-in browser: a server answers it when it was made with `token:
// TOKEN`. `anonymous` is the same read without the session, as another program would make it.
export function request(server: OteaServer, path: string, host = LOCAL_HOST): Promise<Response> {
  return Promise.resolve(server.app.request(path, { headers: { host, cookie: SESSION_COOKIE } }));
}

export function anonymous(server: OteaServer, path: string, host = LOCAL_HOST): Promise<Response> {
  return Promise.resolve(server.app.request(path, { headers: { host } }));
}
