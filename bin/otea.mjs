#!/usr/bin/env node
// The otea command, of a checkout (for `npm link`) and of the published package: npm puts a real
// command on the PATH that runs this file on the system's Node (a symlink on macOS and Linux; otea.cmd,
// otea.ps1 and a shell script on Windows), so every shell finds it, an agent's included, where an
// alias reaches only the shell that defined it.
import { existsSync } from 'node:fs';
import module from 'node:module';

// The compiled code is kept between runs: each command starts faster after the first.
module.enableCompileCache?.();

// Node warns that type stripping and node:sqlite are experimental on every run; otea's output is
// read by people and agents, so those notices stay out of it (as --disable-warning would).
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const [options] = rest;
  const type = typeof options === 'string' ? options : options?.type;
  const name = warning instanceof Error ? warning.name : type;
  if (name === 'ExperimentalWarning') return;
  emitWarning(warning, ...rest);
};

// A checkout runs its TypeScript source, as Node strips the types. The published package carries
// the compiled dist instead: Node does not strip types of a file under node_modules.
const source = new URL('../src/cli/main.ts', import.meta.url);
await import(
  existsSync(source) ? source.href : new URL('../dist/cli/main.js', import.meta.url).href
);
