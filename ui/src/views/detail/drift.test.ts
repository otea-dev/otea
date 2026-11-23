import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { driftText } from './drift.ts';

// P3C-R3-1: a clone without Otea's hook pushed to the branch while the person reviews it; the desk
// says so before they approve, and that approving approves only what was handed off.
describe('driftText', () => {
  afterEach(() => setLanguage('en'));

  it('names each commit pushed after the handoff with who pushed it, and the commit handed off', () => {
    setLanguage('es');
    const drift = {
      branch: 'feat/bill-102',
      handed: 'a752d6f',
      now: '3700ab0',
      added: [
        { commit: '3700ab0', author: 'Diego' },
        { commit: '41bc0de', author: 'Lucía' },
      ],
    };
    expect(driftText(drift)).toBe(
      'Alguien subió commits a la rama después de la entrega: 3700ab0 de Diego, 41bc0de de Lucía. Aprobar aprueba solo lo entregado, a752d6f.',
    );
    setLanguage('en');
    expect(driftText(drift)).toBe(
      'Someone pushed commits to the branch after the handoff: 3700ab0 by Diego, 41bc0de by Lucía. Approving approves only what was handed off, a752d6f.',
    );
  });

  it('says where the branch is now when no new commit explains it (a force push)', () => {
    setLanguage('es');
    const drift = { branch: 'feat/x', handed: 'a752d6f', now: '9f00aa1', added: [] };
    expect(driftText(drift)).toBe(
      'La rama cambió en el remoto después de la entrega: ahora está en 9f00aa1. Aprobar aprueba solo lo entregado, a752d6f.',
    );
  });

  // P1-F1: on a board kept on main the base is the branch, and the commits are not a remote's.
  it('names the commits on main after the handoff, and says a push of main takes them along', () => {
    const drift = {
      branch: 'main',
      handed: 'a715597',
      now: '9f00aa1',
      added: [{ commit: '9f00aa1', author: 'Diego' }],
      onBase: true as const,
    };
    expect(driftText(drift)).toBe(
      'main holds commits made after the handoff, which are not part of this item: 9f00aa1 by Diego. Approving approves only what was handed off, a715597; a push of main takes them along.',
    );
    setLanguage('es');
    expect(driftText({ ...drift, added: [] })).toBe(
      'main cambió después de la entrega: ahora está en 9f00aa1. Aprobar aprueba solo lo entregado, a715597.',
    );
  });
});
