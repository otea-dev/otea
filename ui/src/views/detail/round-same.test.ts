import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n/i18n.ts';
import { roundSameText } from './round-same.ts';

// P5-F2: a round that holds the same files as the one it answers is said before the person approves.
describe('roundSameText', () => {
  afterEach(() => setLanguage('en'));

  it('names the round it repeats, in both languages', () => {
    const same = { branch: 'feat/pie-2', tip: 'b2c3d4e', earlier: 'a1b2c3d', round: 1 };
    expect(roundSameText(same)).toBe(
      'This round holds the same files as round 1 (a1b2c3d): nothing changed in feat/pie-2 since that round. Approving approves what that round already had.',
    );
    setLanguage('es');
    expect(roundSameText(same)).toBe(
      'Esta ronda tiene los mismos archivos que la ronda 1 (a1b2c3d): no cambió nada en feat/pie-2 desde esa ronda. Aprobar aprueba lo que esa ronda ya tenía.',
    );
  });
});
