import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

// A person is asked only when the answer is typed at a terminal and the question is shown on one:
// input and output both. A pipe on either end means a script, a log or an agent's shell.
export function canAsk(input: { isTTY?: boolean }, output: { isTTY?: boolean }): boolean {
  return input.isTTY === true && output.isTTY === true;
}

const aborted = () => new DOMException('The operation was aborted', 'AbortError');

// Asks one question and resolves with the line typed. It rejects with an AbortError when the
// person cancels: Ctrl+C (a terminal in raw mode never raises SIGINT on the process; readline
// reports it on its own interface, and with no listener it only pauses the input, leaving the
// question pending for good), Ctrl+D, or the process being interrupted.
export function askAt(
  question: string,
  io: {
    input: Readable;
    output: Writable;
    signal?: AbortSignal | undefined;
    terminal?: boolean | undefined;
  },
): Promise<string> {
  const prompt = createInterface({
    input: io.input,
    output: io.output,
    ...(io.terminal === undefined ? {} : { terminal: io.terminal }),
  });
  return new Promise<string>((resolve, reject) => {
    prompt.once('SIGINT', () => reject(aborted()));
    prompt.once('close', () => reject(aborted()));
    prompt
      .question(question, io.signal ? { signal: io.signal } : {})
      .then(resolve, reject)
      .finally(() => prompt.close());
  });
}
