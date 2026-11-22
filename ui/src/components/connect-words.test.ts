import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { ledeKey, PLAIN_CONNECT_KEYS, whereKey } from './connect-words.ts';

// P4 (a person who does not program) found «Conectar un agente» full of worktree, MCP and harness.
// What a person reads there is the plain register: its keys name no tool, command or file an agent
// works with, in either language. What the agent needs is reachable behind «Detalles técnicos».
const JARGON =
  /\b(mcp|harness|worktree|agents\.md|cli|terminal|branch|rama|commit|repositorio|repository|prompt)\b|--|`/i;

const said = (catalog: Record<string, unknown>, key: string) => JSON.stringify(catalog[key]);

describe('the plain register of first contact', () => {
  for (const [language, catalog] of [
    ['English', en],
    ['Spanish', es],
  ] as const) {
    it(`names no tool or command to the person, in ${language}`, () => {
      const jargon = PLAIN_CONNECT_KEYS.filter((key) =>
        JARGON.test(said(catalog as Record<string, unknown>, key)),
      );
      expect(jargon).toEqual([]);
    });

    it(`keeps what an agent needs reachable behind the details, in ${language}`, () => {
      const details = said(catalog as Record<string, unknown>, 'connect.tech.mcp');
      expect(details).toMatch(/MCP/);
      expect(details).toMatch(/harness/);
      expect(details).toMatch(/AGENTS\.md/);
    });
  }
});

describe('the words that fit the moment and the board', () => {
  it('writes the first contact for code or for a folder of files', () => {
    expect(ledeKey({ kind: 'start', code: true })).toBe('connect.ledeStartCode');
    expect(ledeKey({ kind: 'start', code: false })).toBe('connect.ledeStartFiles');
    expect(ledeKey(null)).toBe('connect.ledeStartCode');
  });

  it('tells the first agent of a project with boards apart from one that joins', () => {
    expect(ledeKey({ kind: 'join', first: true })).toBe('connect.ledeFirst');
    expect(ledeKey({ kind: 'join' })).toBe('connect.ledeJoin');
  });

  it('says where an agent that joins works: its own copy of code, or the shared folder', () => {
    expect(whereKey({ kind: 'join', code: true })).toBe('connect.whereCode');
    expect(whereKey({ kind: 'join', code: true, first: true })).toBe('connect.whereCode');
    expect(whereKey({ kind: 'join', code: false })).toBe('connect.whereFiles');
    // Nobody works beside the first agent of a folder, and no one starting out works anywhere yet.
    expect(whereKey({ kind: 'join', code: false, first: true })).toBeUndefined();
    expect(whereKey({ kind: 'start', code: true })).toBeUndefined();
  });
});
