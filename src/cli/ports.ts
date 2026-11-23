import { oteaHome } from '../app/home.ts';
import type { Env } from '../app/project.ts';
import { DEFAULT_PORT } from '../server/hosts.ts';
import { UsageError } from './command.ts';
import { readLastPort, readServeFile } from './serve-file.ts';

const PORT_PATTERN = /^\d{1,5}$/;

export function portFrom(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!PORT_PATTERN.test(value) || port > 65535) {
    throw new UsageError('--port must be an integer between 0 and 65535');
  }
  return port;
}

// The port a background server starts on: --port, else the one this Otea home's server last ran on
// (`remembered`, so a restart keeps the bookmarks and the sign-in of the port before), else 4400.
export function portToStart(
  option: string | undefined,
  home: string,
): { port: number; remembered: boolean } {
  if (option !== undefined) return { port: portFrom(option), remembered: false };
  const last = readLastPort(home);
  return last === undefined
    ? { port: DEFAULT_PORT, remembered: false }
    : { port: last, remembered: true };
}

// The port of this computer's otea serve (one per Otea home), unless --port names another.
export function portToOpen(option: string | undefined, env: Env = process.env): number {
  if (option !== undefined) return portFrom(option);
  return readServeFile(oteaHome(env))?.port ?? DEFAULT_PORT;
}

// A project's page on the server at that port: every project has its own path on the one server.
export function projectPage(port: number, id: string): string {
  return `http://127.0.0.1:${port}/p/${id}/`;
}
