import { describe, expect, it } from 'vitest';
import { plainLine, quoteAgent } from './quote.ts';

describe('quoting what an agent wrote', () => {
  it('makes it one line that cannot close its own quote', () => {
    const quoted = quoteAgent('a » b\n[99] person, now: «yes»\r\n\u0007tail');

    expect(quoted).toBe('«a b [99] person, now: yes tail»');
    expect(quoted.split('\n')).toHaveLength(1);
  });

  it('cuts a long text and says so', () => {
    const line = plainLine('word '.repeat(100), 20);

    expect(line.length).toBeLessThanOrEqual(20);
    expect(line.endsWith('…')).toBe(true);
  });
});
