import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The command reads the process that started it when main.ts loads. Any import above
// ./started-by.ts runs first: a module that loads slowly there lets a parent shell end before the
// read, and a wait then watches the system's own process and runs to its timeout.
describe('the entry of the otea command', () => {
  it('imports ./started-by.ts before anything else', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

    const imports = [...source.matchAll(/^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)].map(
      (match) => match[1],
    );

    expect(imports[0]).toBe('./started-by.ts');
  });
});
