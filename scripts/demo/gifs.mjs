// Records the README's animated GIFs from the real desk: the agent's side with real `otea` commands,
// the person's side on a real browser page. Each GIF is a few settled states, held to be read and
// joined by hard cuts, cropped to where the change is, with a caption (see capture.mjs, flows.mjs).
//
//   npm run demo:gifs                 every flow, light and dark
//   npm run demo:gifs -- --only loop  one flow (loop, question, matrix)
//   npm run demo:gifs -- --scheme light
//   npm run demo:gifs -- --out <dir>  another output folder
//
// Everything runs in a throwaway folder under the system temp dir, with its own OTEA_HOME and a
// fictional English project, on port 4995. It never touches your own Otea home or server. Needs a
// built UI (npm run build:ui), a Chromium from Playwright, and ffmpeg.
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { hasFfmpeg, sleep, toGif } from './capture.mjs';
import { flows } from './flows.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.OTEA_REPO ?? resolve(here, '..', '..');
const PORT = 4995;
const MAX_BYTES = 3 * 1024 * 1024;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = opt('only', '').split(',').filter(Boolean);
const schemes = opt('scheme', 'both') === 'both' ? ['light', 'dark'] : [opt('scheme', 'both')];
const outDir = resolve(repo, opt('out', 'docs/images'));

const runDir = mkdtempSync(join(tmpdir(), 'otea-demo-'));
console.log(`work folder: ${runDir}`);

function portFree(port) {
  return new Promise((ok) => {
    const probe = net.connect(port, '127.0.0.1');
    probe.once('connect', () => {
      probe.destroy();
      ok(false);
    });
    probe.once('error', () => ok(true));
  });
}

// A project in a throwaway folder, outside the repo, and a server on it.
async function startDesk(label) {
  const base = join(runDir, label);
  const home = join(base, 'home');
  const project = join(base, 'harbor-notes');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  const rel = relative(repo, project);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('project inside the repo');
  // English comes from the computer's own language, which is where Otea looks while no desk has told
  // it the person's (the desk does, once the browser opens in English): everything made before that
  // moment, init and the boards, comes in English.
  const env = { ...process.env, OTEA_HOME: home, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };
  delete env.LC_MESSAGES;
  delete env.OTEA_AGENT;
  const otea = async (argv, as) => {
    const full = [join(repo, 'bin', 'otea.mjs'), ...(as ? ['--as', as] : []), ...argv];
    try {
      const { stdout } = await exec(process.execPath, full, { cwd: project, env });
      return stdout;
    } catch (e) {
      throw new Error(`otea ${argv.join(' ')} failed: ${e.stderr || e.message}`);
    }
  };
  // An English project: its boards, steps and Requests board all come in English.
  await otea(['init']);

  const server = spawn(
    process.execPath,
    [join(repo, 'bin', 'otea.mjs'), 'serve', '--port', String(PORT), '--no-open'],
    { cwd: project, env },
  );
  let log = '';
  const link = await new Promise((ok, fail) => {
    const feed = (d) => {
      log += d;
      const m = log.match(/https?:\/\/\S+\/auth\?\S+/);
      if (m) ok(m[0]);
    };
    server.stdout.on('data', feed);
    server.stderr.on('data', feed);
    server.once('exit', () =>
      fail(new Error(`serve stopped: ${log.replace(/token=\S+/g, 'token=…')}`)),
    );
    setTimeout(() => fail(new Error('serve did not start')), 20000);
  });
  return {
    otea,
    link,
    base,
    project,
    // Stops the server this run started, by its pid, and nothing else.
    stop: () => server.kill(),
  };
}

async function main() {
  if (!(await portFree(PORT)))
    throw new Error(`port ${PORT} is in use: stop whatever holds it first`);
  if (!existsSync(join(repo, 'ui', 'dist', 'index.html')))
    throw new Error('the UI is not built: run npm run build:ui first');
  if (!hasFfmpeg()) throw new Error('ffmpeg is needed to make the GIFs');
  // The full Chromium, not the headless shell: install it with npx playwright-core install chromium.
  const browser = await chromium.launch({ channel: 'chromium' }).catch((e) => {
    throw new Error(
      `no Chromium to record with (npx playwright-core install chromium): ${e.message.split('\n')[0]}`,
    );
  });
  const made = [];
  try {
    for (const [name, flow] of Object.entries(flows)) {
      if (only.length && !only.includes(name)) continue;
      for (const scheme of schemes) {
        const label = `${name}-${scheme}`;
        const desk = await startDesk(label);
        const stopOnSignal = () => desk.stop();
        process.once('SIGINT', stopOnSignal);
        try {
          const dir = join(desk.base, 'frames');
          const clip = await flow.run({ browser, desk, scheme, dir, sleep });
          const out = join(desk.base, `${flow.file}-${scheme}.gif`);
          const seconds = await toGif(clip.frames, {
            out,
            listFile: join(desk.base, 'clip.txt'),
            colors: clip.colors ?? 128,
          });
          mkdirSync(outDir, { recursive: true });
          const dest = join(outDir, `demo-${flow.file}-${scheme}.gif`);
          copyFileSync(out, dest);
          const bytes = statSync(dest).size;
          if (bytes > MAX_BYTES) throw new Error(`${dest} is ${bytes} bytes: over the 3 MB limit`);
          made.push(`${dest}  ${(bytes / 1024).toFixed(0)} KB  ${seconds.toFixed(1)} s`);
        } finally {
          process.off('SIGINT', stopOnSignal);
          desk.stop();
          await sleep(500);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(made.join('\n'));
  writeFileSync(join(runDir, 'made.txt'), `${made.join('\n')}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
