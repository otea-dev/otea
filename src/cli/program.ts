import { fetchProbe } from '../app/phone.ts';
import { systemTailscale } from '../app/tailscale-cli.ts';
import { askAt, canAsk } from './ask.ts';
import { ghForge } from './forge.ts';
import { systemOpener } from './opener.ts';
import { run } from './run.ts';

const interrupt = new AbortController();
process.once('SIGINT', () => interrupt.abort());

// Only a person at a terminal is asked anything (the answer typed on one, the question shown on
// one); scripts pass every answer as an option. Ctrl+C rejects the question with an AbortError.
const ask = (question: string) =>
  askAt(question, { input: process.stdin, output: process.stderr, signal: interrupt.signal });

async function stdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  signal: interrupt.signal,
  openUrl: systemOpener(),
  tailscale: systemTailscale(),
  probe: fetchProbe,
  gh: 'gh',
  forge: ghForge('gh'),
  fetch: globalThis.fetch,
  // A terminal on stdin is never read as a pipe; it is asked only when the question has one too.
  ...(process.stdin.isTTY ? (canAsk(process.stdin, process.stderr) ? { ask } : {}) : { stdin }),
});
