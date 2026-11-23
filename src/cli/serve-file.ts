import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SERVE_FILE = 'serve.json';

// `links`: the server redeems the single-use sign-in links a command prints (signin-links.ts); one
// started by an older Otea does not say so, and no such link is printed for it.
const ServeInfo = z.object({
  port: z.number().int(),
  pid: z.number().int(),
  links: z.boolean().optional(),
  // The Otea version that runs the server. A server started by 0.4.0 or earlier says nothing, and
  // is taken as older than any that does.
  version: z.string().optional(),
});

export type ServeInfo = z.infer<typeof ServeInfo>;

// A server keeps running its old code after the package under it is upgraded. What to tell a person
// when the server they reach is not the installed version (or says nothing of its own); nothing
// when it is. Never a restart of its own: ending the server is the person's to do.
export function serverVersionNote(
  info: ServeInfo | undefined,
  installed: string,
): string | undefined {
  if (!info || info.version === installed) return undefined;
  const runs = info.version ? `Otea ${info.version}` : 'an older Otea (it recorded no version)';
  return `The server running here (pid ${info.pid}) is ${runs}, and ${installed} is installed: to use the installed one, run otea serve stop, then otea serve start`;
}

// The port the background server of this home last ran on, by the port it was asked for. serve.json
// goes with the server; this stays, so the next `otea serve start` comes back on the same port
// (bookmarks and a sign-in cookie are per port).
export const LAST_PORT_FILE = 'serve-port';

// `remember`: only the background server (otea serve start) keeps its port for the next start; a
// foreground otea serve, or a port the system picked (--port 0), is a one-off.
export function writeServeFile(dir: string, info: ServeInfo, remember = false): void {
  writeFileSync(join(dir, SERVE_FILE), `${JSON.stringify(info)}\n`);
  if (remember) writeFileSync(join(dir, LAST_PORT_FILE), `${info.port}\n`);
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
