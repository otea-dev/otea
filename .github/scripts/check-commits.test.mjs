import { describe, expect, it } from 'vitest';
import { problemWith, TYPES } from './check-commits.mjs';

describe('the commit subjects a pull request may carry', () => {
  it('accepts every type release-please knows, with a scope, a bang or neither', () => {
    for (const type of TYPES) {
      expect(problemWith(`${type}: say the thing`)).toBeUndefined();
      expect(problemWith(`${type}(board): say the thing`)).toBeUndefined();
      expect(problemWith(`${type}(board)!: say the thing`)).toBeUndefined();
      expect(problemWith(`${type}!: say the thing`)).toBeUndefined();
    }
  });

  it('accepts what Dependabot, release-please and GitHub write', () => {
    for (const subject of [
      'chore(deps): bump the npm-minor-patch group across 1 directory with 8 updates',
      'chore(deps-dev): bump vitest from 5.1.0 to 5.1.1',
      'chore: release 0.2.0',
      'Revert "feat(board): a thing"',
      'Merge pull request #12 from otea-dev/branch',
      "Merge branch 'main' into fix/thing",
      "Merge remote-tracking branch 'origin/main' into fix/thing",
    ]) {
      expect(problemWith(subject), subject).toBeUndefined();
    }
  });

  it('refuses what release-please would skip or misread', () => {
    for (const subject of [
      'Update the board',
      'fix the board',
      'Fix: the board',
      'fix:the board',
      'fix: ',
      'fix(): the board',
      'wip: the board',
      'feature: the board',
      'fixup! fix: the board',
      'revert the board',
      '',
    ]) {
      expect(problemWith(subject), subject).toBeDefined();
    }
  });
});
