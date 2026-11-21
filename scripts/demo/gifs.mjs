// Records the README's animated GIFs from the real desk, driving it live: the agent's side with
// real `otea` commands, the person's side with a visible pointer.
//
//   npm run demo:gifs                 every flow, light and dark
//   npm run demo:gifs -- --only loop  one flow
//   npm run demo:gifs -- --scheme light
//
// Everything runs in a throwaway folder under the system temp dir, with its own OTEA_HOME and a
// fictional project, on port 4995. It never touches your own Otea home or server. Needs a built UI
// (npm run build:ui), a Chromium from Playwright, and ffmpeg for the GIFs.
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { framesToClip, hasFfmpeg, openStage, sleep, toGif } from './capture.mjs';
import { flows } from './flows.mjs';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const PORT = 4995;
const FFMPEG = hasFfmpeg();

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
  const env = { ...process.env, OTEA_HOME: home };
  delete env.OTEA_AGENT;
  const otea = async (argv, as) => {
    const full = [join(repo, 'bin', 'otea.mjs'), ...(as ? ['--as', as] : []), ...argv];
    try {
      const began = Date.now();
      const { stdout } = await exec(process.execPath, full, { cwd: project, env });
      if (process.env.DEMO_TRACE) console.log(`otea ${argv[0]} took ${Date.now() - began} ms`);
      return stdout;
    } catch (e) {
      throw new Error(`otea ${argv.join(' ')} failed: ${e.stderr || e.message}`);
    }
  };
  await otea(['init']);

  const server = spawn(
    process.execPath,
    [join(repo, 'bin', 'otea.mjs'), 'serve', '--port', String(PORT), '--no-open'],
    {
      cwd: project,
      env,
    },
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
  // The full Chromium, not the headless shell: install it with npx playwright-core install chromium.
  const browser = await chromium.launch({ channel: 'chromium' }).catch((e) => {
    throw new Error(
      `no Chromium to record with (npx playwright-core install chromium): ${e.message.split('\n')[0]}`,
    );
  });
  if (!FFMPEG) console.log('ffmpeg not found: the frames are kept but no GIF is made');
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
          const framesDir = join(desk.base, 'frames');
          const clips = await flow.run({ browser, desk, scheme, framesDir, openStage, sleep });
          if (!FFMPEG) {
            console.log(`${label}: ffmpeg not found; frames are in ${framesDir}`);
            continue;
          }
          const out = join(desk.base, `${flow.file ?? name}-${scheme}.gif`);
          const lists = [];
          let duration = 0;
          for (const [i, c] of clips.entries()) {
            const clip = framesToClip(c.frames, {
              from: c.from,
              to: c.to,
              skips: c.skips,
              out: join(desk.base, `clip${i}`),
            });
            lists.push(clip.list);
            duration = Math.max(duration, clip.length);
          }
          await toGif(lists, {
            out,
            width: flow.width,
            fps: flow.fps ?? 15,
            colors: flow.colors ?? 160,
            duration,
            divider: flow.divider,
          });
          mkdirSync(outDir, { recursive: true });
          const dest = join(outDir, `demo-${flow.file}-${scheme}.gif`);
          copyFileSync(out, dest);
          const kb = statSync(dest).size / 1024;
          made.push(`${dest}  ${kb.toFixed(0)} KB  ${duration.toFixed(1)} s`);
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
