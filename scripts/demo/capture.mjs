// Screen capture for the README GIFs: a CDP screencast of a Playwright page (crisp frames, taken
// when the page repaints and stamped by the browser), a visible cursor with click ripples, and
// ffmpeg to turn the frames into a GIF.
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
}

// A cursor and a click ripple drawn in the page, so they are in the frames. Playwright's own
// pointer is invisible. Styled to stay legible on both the light and the dark desk.
const CURSOR_SCRIPT = `
(() => {
  const css = document.createElement('style');
  css.textContent = [
    '#demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-2px 0 0 -2px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}',
    '#demo-cursor.finger{width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(40,50,80,.35);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.35)}',
    '#demo-ripple{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #2f5bd8;background:rgba(47,91,216,.18);z-index:2147483646;pointer-events:none;opacity:0}',
    '#demo-ripple.go{animation:demo-ripple .5s ease-out}',
    '@keyframes demo-ripple{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.5)}}',
  ].join('');
  // No red squiggles under what is typed.
  window.addEventListener('focusin', (e) => {
    if (e.target && 'spellcheck' in e.target) e.target.spellcheck = false;
  }, true);
  const mount = () => {
    if (document.getElementById('demo-cursor')) return;
    document.head.append(css);
    const cur = document.createElement('div');
    cur.id = 'demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 8.2-6 1.6 3.6 6.4-2.8 1.6-3.6-6.4L4 18.6z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (window.__demoFinger) {
      cur.className = 'finger';
      cur.textContent = '';
    }
    const rip = document.createElement('div');
    rip.id = 'demo-ripple';
    document.body.append(rip, cur);
    window.addEventListener('mousemove', (e) => {
      cur.style.opacity = '1';
      cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }, true);
    window.addEventListener('mousedown', (e) => {
      rip.style.left = e.clientX + 'px';
      rip.style.top = e.clientY + 'px';
      rip.classList.remove('go');
      void rip.offsetWidth;
      rip.classList.add('go');
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;

// A page whose frames are captured. `start()` begins the capture at the moment the scene is set,
// `stop()` returns the frames, `glide`/`click`/`type` move the pointer so it can be seen.
export async function openStage(
  browser,
  { width, height, scale = 1, scheme = 'light', cursor = 'arrow' },
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'en-US',
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  if (cursor === 'finger') await context.addInitScript('window.__demoFinger = true;');
  if (cursor) await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const pos = { x: width * 0.55, y: height * 0.4 };
  const frames = [];
  let writes = [];
  let dir = null;
  let n = 0;

  cdp.on('Page.screencastFrame', (f) => {
    const file = join(dir, `f${String(n++).padStart(5, '0')}.jpg`);
    frames.push({ at: f.metadata.timestamp, file });
    writes.push(writeFile(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  const stage = {
    page,
    context,
    pos,
    skips: [],
    // DEMO_TRACE=1 prints when each step happened, in seconds into the clip.
    trace(what) {
      if (process.env.DEMO_TRACE)
        console.log(what, (Date.now() / 1000 - stage.startedAt).toFixed(1));
    },
    async start(framesDir) {
      dir = framesDir;
      mkdirSync(dir, { recursive: true });
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 90,
        maxWidth: width * scale,
        maxHeight: height * scale,
        everyNthFrame: 4,
      });
      // Force a first frame even when the page is still.
      await page.evaluate(() => window.scrollBy(0, 0));
      stage.startedAt = Date.now() / 1000;
    },
    async stop() {
      stage.stoppedAt = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
      writes = [];
      return frames;
    },
    // Time-based, so a busy browser makes it choppier, not longer.
    async glide(x, y, ms = 500) {
      const from = { ...pos };
      const t0 = Date.now();
      for (;;) {
        const t = Math.min(1, (Date.now() - t0) / ms);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        if (t >= 1) break;
        await sleep(8);
      }
      pos.x = x;
      pos.y = y;
    },
    // Glide onto a locator and press it, as a person would.
    async click(locator, { ms = 450, hold = 70, at = [0.5, 0.5] } = {}) {
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
      } catch (e) {
        // Leave a picture of where the scene got stuck, beside the frames.
        await page.screenshot({ path: join(dir, 'stuck.png') }).catch(() => {});
        throw e;
      }
      // A row that is still sliding into place is waited for, then the pointer is nudged onto it.
      const settled = async () => {
        let last = await locator.boundingBox();
        for (let i = 0; i < 60; i++) {
          await sleep(50);
          const now = await locator.boundingBox();
          if (now && last && Math.abs(now.x - last.x) + Math.abs(now.y - last.y) < 0.5) return now;
          last = now;
        }
        return last;
      };
      const aim = (b) => [b.x + b.width * at[0], b.y + b.height * at[1]];
      let box = await settled();
      if (!box) throw new Error('nothing to click');
      await stage.glide(...aim(box), ms);
      box = await settled();
      if (!box) throw new Error('nothing to click');
      const [ax, ay] = aim(box);
      if (Math.abs(ax - pos.x) + Math.abs(ay - pos.y) > 2) await stage.glide(ax, ay, 160);
      await sleep(hold);
      await page.mouse.down();
      await sleep(60);
      await page.mouse.up();
      stage.trace('click');
    },
    async type(text, perChar = 28) {
      await page.keyboard.type(text, { delay: perChar });
      stage.trace('typed');
    },
    // Something that takes real time but nothing a viewer needs to wait for, such as an agent's
    // command: the clip jumps from before it to after it.
    async skip(work) {
      const a = Date.now() / 1000;
      const result = await work();
      stage.skips.push([a, Date.now() / 1000]);
      stage.trace('skipped');
      return result;
    },
  };
  return stage;
}

// Frames -> GIF. `from` and `to` are epoch seconds: the part of the capture to keep. Every frame
// lasts until the next one, so a still page costs nothing.
export function framesToClip(rawFrames, { from: rawFrom, to: rawTo, out, skips = [] }) {
  // Skipped stretches are cut out: what lies inside collapses onto its start, so only the state
  // at its end is left to show.
  const shift = (t) => {
    let cut = 0;
    for (const [a, b] of skips) cut += t >= b ? b - a : t > a ? t - a : 0;
    return t - cut;
  };
  const frames = rawFrames.map((f) => ({ ...f, at: shift(f.at) }));
  const from = shift(rawFrom);
  const to = shift(rawTo);
  const kept = frames.filter((f) => f.at < to);
  const first = kept.findLastIndex((f) => f.at <= from);
  const list = kept.slice(Math.max(first, 0));
  const lines = ['ffconcat version 1.0'];
  list.forEach((f, i) => {
    const start = Math.max(f.at, from);
    const end = i + 1 < list.length ? list[i + 1].at : to;
    lines.push(
      `file '${f.file.replaceAll('\\', '/')}'`,
      `duration ${Math.max(end - start, 0.001).toFixed(4)}`,
    );
  });
  const last = list.at(-1);
  lines.push(`file '${last.file.replaceAll('\\', '/')}'`);
  const listFile = `${out}.txt`;
  writeFileSync(listFile, `${lines.join('\n')}\n`);
  return { list: listFile, length: to - from };
}

// One or two clips side by side (same height) -> a GIF of `width` px, `fps`, `colors`.
export async function toGif(
  lists,
  { out, width, fps = 15, colors = 160, duration, divider, dither = 'bayer:bayer_scale=5' },
) {
  const inputs = lists.flatMap((l) => ['-f', 'concat', '-safe', '0', '-i', l]);
  const chains = lists.map((_, i) => `[${i}:v]fps=${fps}[v${i}]`);
  const join =
    lists.length > 1
      ? `${chains.join(';')};${lists.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${lists.length}${divider ? `,drawbox=x=${divider - 1}:y=0:w=2:h=ih:color=0x8a93a6:t=fill` : ''}[m]`
      : `[0:v]fps=${fps}[m]`;
  const filter = `${join};[m]scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`;
  await run(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      ...inputs,
      '-filter_complex',
      filter,
      '-t',
      String(duration),
      '-loop',
      '0',
      out,
    ],
    { maxBuffer: 1 << 26 },
  );
}
