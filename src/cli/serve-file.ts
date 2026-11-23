import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SERVE_FILE = 'serve.json';

const ServeInfo = z.object({ port: z.number().int(), pid: z.number().int() });

export type ServeInfo = z.infer<typeof ServeInfo>;

// The port this home's server last ran on. serve.json goes with the server; this stays, so the next
// `otea serve start` comes back on the same port (bookmarks and a sign-in cookie are per port).
export const LAST_PORT_FILE = 'serve-port';

export function writeServeFile(dir: string, info: ServeInfo): void {
  writeFileSync(join(dir, SERVE_FILE), `${JSON.stringify(info)}\n`);
  writeFileSync(join(dir, LAST_PORT_FILE), `${info.port}\n`);
}

export function readLastPort(dir: string): number | undefined {
  try {
    const port = Number(readFileSync(join(dir, LAST_PORT_FILE), 'utf8').trim());
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

export function readServeFile(dir: string): ServeInfo | undefined {
  try {
    const parsed = ServeInfo.safeParse(JSON.parse(readFileSync(join(dir, SERVE_FILE), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function removeServeFile(dir: string, pid: number): void {
  if (readServeFile(dir)?.pid === pid) rmSync(join(dir, SERVE_FILE), { force: true });
}
