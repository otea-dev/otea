import { describe, expect, it } from 'vitest';
import { deviceOf, isStale, PAGE_VERSION, report } from './version.ts';

describe('the report a person copies', () => {
  it('carries no folder, no address and no name, whatever the pieces say', () => {
    const text = report({
      page: '0.4.0',
      server: { version: '0.4.0', platform: 'C:\\Users\\ana\\otea' },
      desktop: '/home/ana/.local/Otea 1.0',
      phone: false,
      device: 'http://192.168.1.5:4400/p/mine ~',
    });
    expect(text).not.toMatch(/[\\/:~]/);
    expect(text.startsWith('Otea 0.4.0 · page 0.4.0 ·')).toBe(true);
  });

  it('names the desktop app, the phone or the browser', () => {
    const facts = { page: '1', server: { version: '1', platform: 'win32' }, device: 'Win32' };
    expect(report({ ...facts, phone: false, desktop: '2.0.0' })).toBe(
      'Otea 1 · page 1 · server on win32 · desktop app 2.0.0 on Win32',
    );
    expect(report({ ...facts, phone: true })).toContain('phone browser on Win32');
    expect(report({ ...facts, phone: false })).toContain('browser on Win32');
  });
});

describe('the page against the server', () => {
  it('is stale only when its version is not the server’s', () => {
    expect(isStale('0.3.9', { version: '0.4.0', platform: 'linux' })).toBe(true);
    expect(isStale(PAGE_VERSION, { version: PAGE_VERSION, platform: 'linux' })).toBe(false);
  });

  it('is built as the package’s own version', () => {
    expect(PAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the device', () => {
  it('prefers what the browser says in its client hints, then its platform', () => {
    expect(deviceOf({ platform: 'Win32', userAgentData: { platform: 'Windows' } })).toBe('Windows');
    expect(deviceOf({ platform: 'MacIntel' })).toBe('MacIntel');
    expect(deviceOf({})).toBe('unknown');
  });
});
