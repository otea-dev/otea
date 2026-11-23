// Builds the CLI the npm package runs: src/cli/main.ts and the packages it uses, bundled into
// dist/cli: main.js (the version answer alone), one file for the commands every call needs, and one
// each for what is loaded only when asked (the desk server, the MCP server). A command then reads
// a dozen files instead of the ~250 modules of its graph (95 of them zod's), which is what each
// call cost on a machine whose antivirus looks at every file opened.
// The packages a bundle takes in keep their licenses: dist/cli/THIRD_PARTY_LICENSES.txt has each
// one's, and the build fails when a package it bundled has none (see licensesOf). Legal comments
// stay at the end of each file (legalComments: 'eof').
// A checkout runs src/ directly (Node strips the types), and the desktop app carries src/ too: only
// the published package runs this build. Run: node scripts/build-cli.mjs [outdir]
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_FILE = /^licen[cs]e(\.|$)/i;
const SEPARATOR = '-'.repeat(40);

// The folder of the package a path under node_modules belongs to (the innermost, when they nest):
// `node_modules/zod`, `node_modules/a/node_modules/@scope/b`.
function packageFolder(input) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = input.slice(at + marker.length).split('/');
  const name = parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name ? input.slice(0, at + marker.length + name.length) : undefined;
}

// Some packages come already bundled with theirs inside: @modelcontextprotocol/server carries ajv,
// jose and others, each file marked `//#region .../node_modules/.pnpm/<name>@<version>/node_modules/...`.
// Those have no folder of their own here, so their license texts are kept in
// scripts/bundled-licenses/<name>@<version>.txt (a scope's / written +), copied from the package.
const INLINED = /\/\/#region [^\n]*?node_modules\/\.pnpm\/([^/\n]+)\/node_modules\//g;

function inlinedPackages(files) {
  const found = new Set();
  for (const file of files) {
    if (!/\.[cm]?js$/.test(file)) continue;
    for (const [, id] of readFileSync(join(root, file), 'utf8').matchAll(INLINED)) {
      // `ajv-formats@3.0.1_ajv@8.18.0`: the package and its version, then the peers pnpm linked.
      const own = id.split('_')[0] ?? id;
      found.add(own.replaceAll('+', '/'));
    }
  }
  return [...found].sort();
}

// The license text of every package the bundle holds, or an error naming those with none: a
// package shipped without its license is not shipped.
function licensesOf(inputs) {
  const entries = [];
  const missing = [];
  const folders = [...new Set(inputs.map(packageFolder).filter(Boolean))].sort();
  for (const folder of folders) {
    const { name, version, license } = JSON.parse(
      readFileSync(join(root, folder, 'package.json'), 'utf8'),
    );
    const file = readdirSync(join(root, folder)).find((each) => LICENSE_FILE.test(each));
    if (!file) {
      missing.push(`${name}@${version}`);
      continue;
    }
    const text = readFileSync(join(root, folder, file), 'utf8').trim();
    entries.push(`${name} ${version} (${license})\n${SEPARATOR}\n${text}\n`);
  }
  const files = inputs.filter((input) => packageFolder(input));
  for (const id of inlinedPackages(files)) {
    const kept = join(root, 'scripts', 'bundled-licenses', `${id.replaceAll('/', '+')}.txt`);
    if (!existsSync(kept)) {
      missing.push(
        `${id} (inlined in a package; add scripts/bundled-licenses/${id.replaceAll('/', '+')}.txt)`,
      );
      continue;
    }
    entries.push(
      `${id.replace(/@(?=[^@]*$)/, ' ')} (inlined)\n${SEPARATOR}\n${readFileSync(kept, 'utf8').trim()}\n`,
    );
  }
  if (missing.length > 0) {
    throw new Error(`No license for a package the CLI bundles: ${missing.join(', ')}`);
  }
  return `The packages bundled into this CLI, with the license each one carries.\n\n${entries.join('\n')}`;
}

// The files keep the depth they have in src (src/cli/x.ts is dist/cli/x.js), because the code finds
// package.json, presets/, schemas/ and ui/dist by a path relative to its own file (../../presets).
export async function buildCli(outdir = join(root, 'dist', 'cli')) {
  rmSync(outdir, { recursive: true, force: true });
  const { metafile } = await build({
    absWorkingDir: root,
    entryPoints: { main: 'src/cli/main.ts' },
    outdir,
    entryNames: '[name]',
    chunkNames: 'part-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // Some packages are CommonJS and ask for a Node module with require.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    metafile: true,
    legalComments: 'eof',
    logLevel: 'warning',
  });
  const licenses = licensesOf(Object.keys(metafile.inputs));
  writeFileSync(join(outdir, 'THIRD_PARTY_LICENSES.txt'), licenses);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // dist/ holds nothing but this build: what an older build left there (a file per module) goes.
  if (!process.argv[2] && existsSync(join(root, 'dist'))) {
    rmSync(join(root, 'dist'), { recursive: true, force: true });
  }
  await buildCli(process.argv[2] ? resolve(process.argv[2]) : undefined);
}
