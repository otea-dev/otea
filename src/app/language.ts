import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { LANGS, type Lang } from '../core/board/template-words.ts';
import { selectPreference, upsertPreference } from '../store/machine.ts';
import { machineDir, withMachine } from './machine.ts';
import type { Env } from './project.ts';
import { system } from './system-locale.ts';

// The language of what Otea makes for the person: the language they use at that moment. A board
// keeps its template's words in every language (core/board/localize.ts), so switching later
// rewrites nothing; the desk reads each board in the language it was made in, as its agent does,
// and the screen's language is for the desk's own words; what agents write is up to the agents.
// The desk knows the language (the person's own choice, kept as a preference of the person in the
// machine store); a command with no desk to ask resolves it here, in one place:
//   1. the language the desk last used,
//   2. the language of this computer (a locale that starts with es is Spanish, any other English),
//   3. English.

const KEY = 'language';

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

// The language the person's desk is in, or none while no desk has told the server.
export function storedLanguage(machine: DatabaseSync): Lang | undefined {
  const value = selectPreference(machine, KEY);
  return isLang(value) ? value : undefined;
}

// Remembers the desk's language. With `onlyIfUnset` (a desk that just opened) it only fills the
// gap, so a phone opening in another language never overrides what the person chose. Returns the
// language that stands.
export function rememberLanguage(machine: DatabaseSync, lang: Lang, onlyIfUnset = false): Lang {
  const stored = storedLanguage(machine);
  if (onlyIfUnset && stored !== undefined) return stored;
  if (stored !== lang) upsertPreference(machine, KEY, lang);
  return lang;
}

// What the machine store holds, without creating a store that is not there yet.
export function storedLanguageAt(env: Env = process.env): Lang | undefined {
  if (!existsSync(join(machineDir(env), 'machine.db'))) return undefined;
  return withMachine(env, storedLanguage);
}

// This computer's language: the locale variables a person set on purpose (LC_ALL, then
// LC_MESSAGES; C and POSIX, with or without an encoding, say nothing), else the one the runtime
// reads from the system, else LANG.
export function systemLanguage(env: Env = process.env, locale = system.locale): Lang {
  const says = (value: string | undefined) =>
    value && !/^(C|POSIX)(\.|$)/.test(value) ? value : '';
  // LC_ALL and LC_MESSAGES are choices; a bare LANG is a default that whatever started the shell
  // may have set (an agent's harness on a Spanish computer carried LANG=en_US.UTF-8, and init made
  // the project in English: field study 3). The language the system itself reports outranks it;
  // where there is none, LANG says. On a POSIX system the system's locale is read from these same
  // variables, so the order changes nothing there.
  const named = says(env.LC_ALL) || says(env.LC_MESSAGES) || locale() || says(env.LANG);
  return /^es(?![a-z])/i.test(named) ? 'es' : 'en';
}

// The one resolver: the stored desk language, else the system's, else English.
export function resolveLang(
  stored: Lang | undefined,
  env: Env = process.env,
  locale?: () => string,
): Lang {
  return stored ?? systemLanguage(env, locale);
}

// The language for what is made with no desk in front of the person.
export function defaultLang(env: Env = process.env): Lang {
  return resolveLang(storedLanguageAt(env), env);
}
