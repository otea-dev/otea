// Builds the CLI the npm package runs: src/cli/main.ts and the packages it uses, bundled into
// dist/cli: main.js (the version answer alone), one file for the commands every call needs, and one
// each for what is loaded only when asked (the desk server, the MCP server). A command then reads
// a dozen files instead of the ~250 modules of its graph (95 of them zod's), which is what each
// call cost on a machine whose antivirus looks at every file opened.
// The packages a bundle takes in keep their licenses: dist/cli/THIRD_PARTY_LICENSES.txt has each one's.
// A checkout runs src/ directly (Node strips the types), and the desktop app carries src/ too: only
// the published package runs this build. Run: node scripts/build-cli.mjs [outdir]
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The package a path under node_modules belongs to, as its folder: `zod`, `@hono/node-server`.
const packageOf = (input) => /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];

function licensesOf(inputs) {
  const names = [...new Set(inputs.map(packageOf).filter(Boolean))].sort();
  const entries = names.map((name) => {
    const folder = join(root, 'node_modules', name);
    const { version, license } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const file = readdirSync(folder).find((each) => /^licen[cs]e(\.|$)/i.test(each));
    const text = file ? readFileSync(join(folder, file), 'utf8').trim() : '(no license file)';
    return `${name} ${version} (${license})\n${'-'.repeat(40)}\n${text}\n`;
  });
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
    legalComments: 'none',
    logLevel: 'warning',
  });
  writeFileSync(join(outdir, 'THIRD_PARTY_LICENSES.txt'), licensesOf(Object.keys(metafile.inputs)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // dist/ holds nothing but this build: what an older build left there (a file per module) goes.
  if (!process.argv[2] && existsSync(join(root, 'dist'))) {
    rmSync(join(root, 'dist'), { recursive: true, force: true });
  }
  await buildCli(process.argv[2] ? resolve(process.argv[2]) : undefined);
}
