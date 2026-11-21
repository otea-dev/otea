// Frames for the README GIFs. A GIF here is a short list of settled states, each held long enough
// to read and joined by hard cuts: every state is a screenshot of the real desk (taken once its
// animations are over), cropped to the part where the change happens, then laid out with a caption
// by a small composer page and encoded by ffmpeg. Nothing is cross-faded.
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = process.env.OTEA_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(repo, 'package.json'));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
}

// A pointer drawn in the page, so it is in the screenshots (Playwright's own is invisible): an
// arrow for the desk, a soft disc for a finger, and a ring where a press lands.
const POINTER_SCRIPT = `
(() => {
  const css = document.createElement('style');
  css.textContent = [
    '#demo-ptr{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}',
    '#demo-ptr.finger{width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(40,50,80,.28);border:2px solid rgba(255,255,255,.95);box-shadow:0 1px 5px rgba(0,0,0,.35)}',
    '#demo-ptr.arrow{width:24px;height:24px;margin:-2px 0 0 -2px}',
    '#demo-ptr.down{transform:scale(.86)}',
    '#demo-ring{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2.5px solid #2f5bd8;background:rgba(47,91,216,.16);z-index:2147483646;pointer-events:none;opacity:0}',
  ].join('');
  window.addEventListener('focusin', (e) => {
    if (e.target && 'spellcheck' in e.target) e.target.spellcheck = false;
  }, true);
  const mount = () => {
    if (document.getElementById('demo-ptr')) return;
    document.head.append(css);
    const ptr = document.createElement('div');
    ptr.id = 'demo-ptr';
    ptr.className = window.__demoFinger ? 'finger' : 'arrow';
    if (!window.__demoFinger)
      ptr.innerHTML = '<svg viewBox="0 0 22 22" width="24" height="24"><path d="M3 2l14 8.2-6 1.6 3.6 6.4-2.8 1.6-3.6-6.4L4 18.6z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.id = 'demo-ring';
    document.body.append(ring, ptr);
    const at = (e) => {
      ptr.style.opacity = '1';
      ptr.style.left = e.clientX + 'px';
      ptr.style.top = e.clientY + 'px';
    };
    window.addEventListener('mousemove', at, true);
    window.addEventListener('mousedown', (e) => {
      at(e);
      ptr.classList.add('down');
      ring.style.left = e.clientX + 'px';
      ring.style.top = e.clientY + 'px';
      ring.style.opacity = '1';
    }, true);
    window.addEventListener('mouseup', () => {
      ptr.classList.remove('down');
      ring.style.opacity = '0';
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

// A page of the desk to take states from. `shot` waits for the page to be still before it takes
// one (nothing moving, so no half-finished animation ends up in a frame).
export async function openStage(
  browser,
  { width, height, scale = 2, scheme = 'light', pointer = 'arrow', dir },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'en-US',
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  if (pointer === 'finger') await context.addInitScript('window.__demoFinger = true;');
  await context.addInitScript(POINTER_SCRIPT);
  const page = await context.newPage();
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const pos = { x: width * 0.6, y: height * 0.5 };
  const stage = {
    page,
    context,
    pos,
    // Rests the pointer on a locator (it glides there in a few steps, so hover states are right).
    async point(locator, at = [0.5, 0.5]) {
      await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
      const b = await locator.boundingBox();
      if (!b) throw new Error('nothing to point at');
      await page.mouse.move(b.x + b.width * at[0], b.y + b.height * at[1], { steps: 6 });
    },
    // Waits until what is in view stops changing, then takes it. `clip` is in CSS pixels.
    async shot(name, clip) {
      let prev = null;
      for (let i = 0; i < 40; i++) {
        const now = await page.screenshot({ ...(clip ? { clip } : {}), type: 'png' });
        if (prev && Buffer.compare(prev, now) === 0) break;
        prev = now;
        await sleep(120);
      }
      const file = join(dir, `${String(n++).padStart(2, '0')}-${name}.png`);
      writeFileSync(file, prev);
      return file;
    },
  };
  return stage;
}

// The desk's own colours, so the composer's ground and ink are the page's.
export async function readTokens(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    return Object.fromEntries(
      ['--ground', '--sheet', '--ink', '--ink-2', '--ink-3', '--you', '--rule', '--rule-2'].map(
        (n) => [n, get(n)],
      ),
    );
  });
}

function fontCss() {
  const file = require.resolve(
    '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
  );
  const data = readFileSync(file).toString('base64');
  return `@font-face{font-family:"Schibsted Grotesk";font-weight:400 900;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
}

const img = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

// Lays a frame out on a page of the final size and returns its PNG. `layout` writes the html of
// the frame from the tokens; the canvas is `width` x `height` pixels, drawn at 1:1.
export async function openComposer(browser, tokens, { width, height }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const vars = Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const base = `<style>${fontCss()}
    :root{${vars}}
    *{box-sizing:border-box}
    html,body{margin:0;width:${width}px;height:${height}px;background:var(--ground);color:var(--ink);font:500 17px/1.25 "Schibsted Grotesk",system-ui,sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased}
  </style>`;
  return {
    img,
    async frame(body, out) {
      await page.setContent(`${base}${body}`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() =>
        Promise.all([...document.images].map((i) => (i.complete ? 1 : i.decode().catch(() => 1)))),
      );
      await page.screenshot({ path: out, type: 'png' });
      return out;
    },
    close: () => context.close(),
  };
}

// Frames -> GIF: each PNG held for its time, hard cuts, one palette for the whole clip.
export async function toGif(frames, { out, listFile, colors = 128, fps = 10 }) {
  const lines = ['ffconcat version 1.0'];
  for (const f of frames) {
    lines.push(`file '${f.png.replaceAll('\\', '/')}'`, `duration ${f.hold.toFixed(3)}`);
  }
  // ffconcat ignores the last duration unless the file is repeated.
  lines.push(`file '${frames.at(-1).png.replaceAll('\\', '/')}'`);
  writeFileSync(listFile, `${lines.join('\n')}\n`);
  const total = frames.reduce((sum, f) => sum + f.hold, 0);
  const filter = `fps=${fps},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  await run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-vf',
      filter,
      '-t',
      total.toFixed(3),
      '-loop',
      '0',
      out,
    ],
    { maxBuffer: 1 << 26 },
  );
  return frames.reduce((s, f) => s + f.hold, 0);
}
