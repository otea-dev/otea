import { describe, expect, it } from 'vitest';
import {
  defaultLang,
  rememberLanguage,
  resolveLang,
  storedLanguage,
  systemLanguage,
} from './language.ts';
import { memoryMachine } from './machine.ts';

// The language for what is made with no desk to ask: what the desk last used, else this
// computer's language, else English. One resolver, so every command agrees.
describe('the default language', () => {
  const nothing = () => '';

  it('is the one the desk last used, over the language of the computer', () => {
    expect(resolveLang('en', { LANG: 'es_ES.UTF-8' }, () => 'es-ES')).toBe('en');
    expect(resolveLang('es', { LANG: 'en_US.UTF-8' }, () => 'en-US')).toBe('es');
  });

  it('is the language of the computer while no desk has said one', () => {
    expect(resolveLang(undefined, { LANG: 'es_AR.UTF-8' }, nothing)).toBe('es');
    expect(resolveLang(undefined, { LANG: 'en_GB.UTF-8' }, nothing)).toBe('en');
    expect(resolveLang(undefined, { LANG: 'fr_FR.UTF-8' }, nothing)).toBe('en');
    expect(resolveLang(undefined, {}, () => 'es-ES')).toBe('es');
    expect(resolveLang(undefined, {}, () => 'de-DE')).toBe('en');
  });

  it('reads the locale variables in their order, and C as saying nothing', () => {
    expect(systemLanguage({ LC_ALL: 'es_ES', LANG: 'en_US' }, nothing)).toBe('es');
    expect(systemLanguage({ LC_ALL: 'en_US', LANG: 'es_ES' }, nothing)).toBe('en');
    expect(systemLanguage({ LC_MESSAGES: 'es_ES', LANG: 'en_US' }, nothing)).toBe('es');
    expect(systemLanguage({ LANG: 'C' }, () => 'es-ES')).toBe('es');
    expect(systemLanguage({ LANG: 'C.UTF-8' }, () => 'es-ES')).toBe('es');
    expect(systemLanguage({ LC_ALL: 'POSIX', LANG: 'es_ES' }, nothing)).toBe('es');
  });

  // Field study 3: init before the desk opened made the project in English for a Spanish user:
  // their computer is Spanish and the shell an agent runs in carried LANG=en_US.UTF-8 (set by the
  // program that started it, never by the person). LC_ALL and LC_MESSAGES are choices; LANG is a
  // default the computer's own language outranks.
  it('on Windows puts the computer language over a bare LANG, and a deliberate LC_ALL over both', () => {
    const os = (locale: string) => () => locale;
    expect(systemLanguage({ LANG: 'en_US.UTF-8' }, os('es-ES'), 'win32')).toBe('es');
    expect(systemLanguage({ LANG: 'es_ES.UTF-8' }, os('en-US'), 'win32')).toBe('en');
    expect(systemLanguage({ LC_ALL: 'en_US.UTF-8', LANG: 'es_ES' }, os('es-ES'), 'win32')).toBe(
      'en',
    );
    expect(systemLanguage({ LC_MESSAGES: 'es_ES', LANG: 'en_US' }, os('en-US'), 'win32')).toBe(
      'es',
    );
    // No variable at all: the computer's.
    expect(systemLanguage({}, os('es-ES'), 'win32')).toBe('es');
  });

  // On POSIX the variables are the locale the system reports: they keep their order, a set LC_ALL
  // wins over the rest, and C and POSIX say nothing, so the next one speaks.
  it('on POSIX keeps LC_ALL, LC_MESSAGES, LANG in that order, and C as unset', () => {
    const os = (locale: string) => () => locale;
    for (const platform of ['linux', 'darwin'] as const) {
      expect(systemLanguage({ LC_ALL: 'C', LANG: 'es_ES.UTF-8' }, os('en-US'), platform)).toBe(
        'es',
      );
      expect(systemLanguage({ LC_ALL: 'POSIX', LANG: 'es_ES' }, os('en-US'), platform)).toBe('es');
      expect(systemLanguage({ LC_ALL: 'en_US.UTF-8', LANG: 'es_ES' }, os('es-ES'), platform)).toBe(
        'en',
      );
      // A set LANG beats the system's own report, as it is where that report comes from.
      expect(systemLanguage({ LANG: 'en_US.UTF-8' }, os('es-ES'), platform)).toBe('en');
      expect(systemLanguage({ LC_MESSAGES: 'es_ES', LANG: 'en_US' }, os('en-US'), platform)).toBe(
        'es',
      );
      // None set: the system's.
      expect(systemLanguage({ LANG: 'C' }, os('es-ES'), platform)).toBe('es');
      expect(systemLanguage({}, os('es-ES'), platform)).toBe('es');
    }
  });

  it('does not take a language that merely begins with es for Spanish', () => {
    expect(systemLanguage({ LANG: 'est_EE' }, nothing)).toBe('en');
  });

  it('is English when nothing says otherwise', () => {
    expect(resolveLang(undefined, {}, nothing)).toBe('en');
    expect(resolveLang(undefined, {}, () => 'en-US')).toBe('en');
  });

  it('reads the desk language from the machine store, and none from a home with no store', () => {
    expect(defaultLang({ OTEA_HOME: `${process.env.OTEA_HOME}-nowhere`, LC_ALL: 'en_US' })).toBe(
      'en',
    );
    const machine = memoryMachine();
    expect(storedLanguage(machine)).toBeUndefined();
    rememberLanguage(machine, 'es');
    expect(storedLanguage(machine)).toBe('es');
    machine.close();
  });

  it('fills a gap on a desk that just opened, and takes a change from a desk that switched', () => {
    const machine = memoryMachine();
    expect(rememberLanguage(machine, 'es', true)).toBe('es');
    expect(rememberLanguage(machine, 'en', true)).toBe('es');
    expect(storedLanguage(machine)).toBe('es');
    expect(rememberLanguage(machine, 'en')).toBe('en');
    expect(storedLanguage(machine)).toBe('en');
    machine.close();
  });
});
