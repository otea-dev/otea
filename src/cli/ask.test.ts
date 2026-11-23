import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { askAt, canAsk } from './ask.ts';

describe('who can be asked', () => {
  it('is a person only when both the input and the output the question goes to are terminals', () => {
    expect(canAsk({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(canAsk({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(canAsk({ isTTY: true }, {})).toBe(false);
    expect(canAsk({ isTTY: false }, { isTTY: true })).toBe(false);
    expect(canAsk({}, {})).toBe(false);
  });
});

// A terminal in raw mode never raises SIGINT on the process: Ctrl+C arrives as a key, which
// readline turns into a SIGINT event on its own interface. Without a listener readline pauses the
// input and the question never settles (the command then exits 13, never "cancelled").
function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  return { input, output };
}

describe('the question asked at a terminal', () => {
  it('answers with the line typed', async () => {
    const { input, output } = terminal();

    const answered = askAt('Pick: ', { input, output, terminal: true });
    input.write('2\n');

    expect(await answered).toBe('2');
  });

  it('rejects with an AbortError on Ctrl+C instead of staying pending', async () => {
    const { input, output } = terminal();

    const answered = askAt('Pick: ', { input, output, terminal: true });
    input.write('\u0003');

    await expect(answered).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with an AbortError when the input ends before an answer (Ctrl+D)', async () => {
    const { input, output } = terminal();

    const answered = askAt('Pick: ', { input, output, terminal: true });
    input.end();

    await expect(answered).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with an AbortError when the process is interrupted', async () => {
    const { input, output } = terminal();
    const controller = new AbortController();

    const answered = askAt('Pick: ', { input, output, terminal: true, signal: controller.signal });
    controller.abort();

    await expect(answered).rejects.toMatchObject({ name: 'AbortError' });
  });
});
