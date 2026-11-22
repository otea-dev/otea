import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { externalUrl, navigationVerdict } from './navigation.ts';

const server = 'http://127.0.0.1:4486/p/alpha-aaaaaa';
const picker = pathToFileURL('/app/dist/picker.html').href;
const where = { serverUrl: server, pickerUrl: picker };

describe('where the window may go', () => {
  it('stays on the project server and the picker page', () => {
    expect(navigationVerdict('http://127.0.0.1:4486/p/beta-bbbbbb/#/', where)).toBe('allow');
    expect(navigationVerdict('http://127.0.0.1:4486/auth?token=x&next=%2Fp%2Fa%2F', where)).toBe(
      'allow',
    );
    expect(navigationVerdict(picker, where)).toBe('allow');
  });

  it('sends a link to another origin to the system browser, never into the window', () => {
    expect(navigationVerdict('https://example.com/a?b=1', where)).toBe('external');
    expect(navigationVerdict('http://127.0.0.1:4487/', where)).toBe('external');
    expect(navigationVerdict('http://localhost:4486/', where)).toBe('external');
  });

  it('blocks what is neither the app nor a plain web link', () => {
    for (const url of [
      'file:///C:/Windows/win.ini',
      pathToFileURL('/app/dist/other.html').href,
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://example.com/',
      'https://user:pw@example.com/',
      'not a url',
    ]) {
      expect(navigationVerdict(url, where), url).toBe('block');
    }
  });

  it('has no server page to stay on while no project is open', () => {
    expect(navigationVerdict('http://127.0.0.1:4486/', { pickerUrl: picker })).toBe('external');
    expect(navigationVerdict(picker, { pickerUrl: picker })).toBe('allow');
  });
});

describe('a link that opens outside the app', () => {
  it('is an http(s) URL without credentials', () => {
    expect(externalUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(externalUrl('http://example.com')).toBe('http://example.com/');
  });

  it('is nothing else', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-msdt:/id',
      'smb://host/share',
      'https://user@example.com/',
      'https://user:pw@example.com/',
      '',
      'nope',
    ]) {
      expect(externalUrl(url), url).toBeUndefined();
    }
  });
});
