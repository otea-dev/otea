import { version as packageVersion } from '../../package.json';
import type { ServerVersion } from './types.ts';

// The Otea this page was built as. The server says which Otea it runs (/api/version); the two differ
// when an update left an old page cached in a browser or an installed app.
export const PAGE_VERSION: string = packageVersion;

// What the report knows, all of it taken from the running pieces: no folder, no name, no address.
export type VersionFacts = {
  page: string;
  server: ServerVersion;
  // The desktop app's own version, when the page runs inside it.
  desktop?: string | undefined;
  phone: boolean;
  // The device's system, as its browser names it ("Win32", "MacIntel", "iPhone").
  device: string;
};

// The text a person pastes into a bug report. English whatever the language of the page, because
// the one who reads it is not necessarily the one who wrote it. Each piece is cut down to the
// characters a version or a system name has, so no path or address can ride along in it.
export function report(facts: VersionFacts): string {
  const plain = (text: string) => text.replace(/[^A-Za-z0-9._+ -]/g, '').trim() || 'unknown';
  const where = facts.desktop
    ? `desktop app ${plain(facts.desktop)}`
    : facts.phone
      ? 'phone browser'
      : 'browser';
  return [
    `Otea ${plain(facts.server.version)}`,
    `page ${plain(facts.page)}`,
    `server on ${plain(facts.server.platform)}`,
    `${where} on ${plain(facts.device)}`,
  ].join(' · ');
}

// The page is not the server's version: it was kept from before an update.
export function isStale(page: string, server: ServerVersion): boolean {
  return page !== server.version;
}

// The system a browser says it runs on, as coarsely as it says it.
export function deviceOf(nav: {
  platform?: string;
  userAgentData?: { platform?: string };
}): string {
  return nav.userAgentData?.platform || nav.platform || 'unknown';
}
