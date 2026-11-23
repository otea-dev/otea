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
