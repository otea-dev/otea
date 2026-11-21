// The scenes. Each flow seeds a fictional project through the real CLI (the agents' moves are real
// `otea` commands), then walks the real desk through a few states and returns the frames of a GIF:
// a settled shot of each state, cropped to where the change is, with a caption, held long enough to
// read. One idea per GIF.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openComposer, openStage, readTokens, sleep } from './capture.mjs';

const DIFF = `diff --git a/src/cart/Totals.tsx b/src/cart/Totals.tsx
index 3f1c2aa..9be41d7 100644
--- a/src/cart/Totals.tsx
+++ b/src/cart/Totals.tsx
@@ -12,6 +12,7 @@ export function Totals({ cart }: { cart: Cart }) {
   return (
     <dl className="totals">
       <Row label="Subtotal" value={money(cart.subtotal)} />
+      <Row label="VAT (21%)" value={money(cart.vat)} />
       <Row label="Shipping" value={money(cart.shipping)} />
       <Row label="Total" value={money(cart.total)} strong />
     </dl>
`;

function cartHtml(withVat) {
  const row = (a, b, strong = false) =>
    `<div class="r${strong ? ' s' : ''}"><span>${a}</span><span>${b}</span></div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;width:720px;height:440px;background:#f4f1ea;font:16px/1.4 system-ui,sans-serif;color:#1d2433;display:flex;align-items:center;justify-content:center}
    .c{width:520px;background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 8px 30px rgba(20,30,60,.12)}
    h1{font:600 20px system-ui;margin:0 0 18px}
    .r{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eee}
    .s{font-weight:700;border-bottom:0;padding-top:16px;font-size:18px}
    .b{margin-top:18px;background:#2f5bd8;color:#fff;border-radius:9px;padding:12px;text-align:center;font-weight:600}
  </style><div class="c"><h1>Your cart</h1>
    ${row('Linen tote bag', '24.00')}${row('Cotton socks, 2 pairs', '9.50')}
    ${row('Subtotal', '33.50')}${withVat ? row('VAT (21%)', '7.04') : ''}${row('Shipping', '4.90')}
    ${row('Total', withVat ? '45.44' : '38.40', true)}<div class="b">Checkout</div></div>`;
}

// The before and after pictures an agent attaches as evidence.
async function makeEvidence(browser, dir) {
  writeFileSync(join(dir, 'cart-vat.diff'), DIFF);
  const ctx = await browser.newContext({ viewport: { width: 720, height: 440 } });
  const page = await ctx.newPage();
  for (const [name, vat] of [
    ['before', false],
    ['after', true],
  ]) {
    await page.setContent(cartHtml(vat));
    await page.screenshot({ path: join(dir, `cart-${name}.png`) });
  }
  await ctx.close();
}

// Two agents with names and models, and a board the way the project starts it (the project is
// English: the demo's computer speaks English, so every word on the desk is).
async function seedAgents({ otea }) {
  await otea(['board', 'add', 'Changes', '--template', 'changes']);
  await otea(
    ['profile', '--model', 'claude-opus-5-5', '--effort', 'high', '--harness', 'claude-code'],
    'quill',
  );
  await otea(
    ['profile', '--model', 'gpt-5.5', '--effort', 'medium', '--harness', 'codex'],
    'lumen',
  );
}

const fields = (work) => [
  '--field',
  `What I want=${work.want}`,
  '--field',
  `How I check it=${work.check}`,
  '--field',
  `Kind of change=${work.kind}`,
  '--field',
  'Effort=Small',
  '--field',
  'Impact=medium',
];

// The caption under every frame: a line in two halves, the one that matters in this frame set in
// ink and the other quiet. The line never changes length, so nothing jumps.
const caption = (halves, on, h) => `
  <div style="position:absolute;left:0;right:0;bottom:0;height:${h}px;display:flex;align-items:center;justify-content:center;gap:.4em;border-top:1px solid var(--rule);background:var(--ground);font-weight:620;font-size:23px;letter-spacing:-.01em">
    ${halves.map((t, i) => `<span style="color:${i === on ? 'var(--ink)' : 'var(--ink-3)'};opacity:${i === on ? 1 : 0.62}">${t}</span>`).join('')}
  </div>`;

const W = 700;
const CAP = 64;

// A: the agent loop. The agent ticks the checklist, the route moves from it to you, you approve.
async function agentLoop({ browser, desk, scheme, dir }) {
  const { otea } = desk;
  await seedAgents(desk);
  await makeEvidence(browser, desk.base);
  const file = (n) => join(desk.base, n);
  await otea(
    [
      'create',
      '--collection',
      'Changes',
      '--title',
      'Show the VAT in the cart',
      ...fields({
        want: 'A VAT line under the subtotal',
        check: '- A VAT line shows under the subtotal',
        kind: 'Visual interface',
      }),
    ],
    'lumen',
  );
  await otea(['next', '--claim'], 'quill');

  const stage = await openStage(browser, { width: 1280, height: 800, scheme, dir });
  const { page } = stage;
  await page.goto(desk.link);
  await page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await page.getByText('Show the VAT in the cart').first().click();
  await page.getByText('is on it.').waitFor();
  await page.mouse.move(1100, 700);
  const tokens = await readTokens(page);

  // The item's page: its title, the route and the checklist, down to the buttons.
  const crop = { x: 794, y: 112, width: 470, height: 440 };
  const states = [];
  // `rows`: how much of the page to take, down to the checklist (440) or, once it is the person's
  // turn, down to what the reviewer reads before the buttons' notes (420).
  const take = async (name, caps, hold, rows = crop.height) => {
    states.push({ png: await stage.shot(name, { ...crop, height: rows }), caps, hold, rows });
  };
  const doing = ['The agent does the steps.', 'You only review.'];
  await take('start', [doing, 0], 1.3);
  await otea(['update', 'CHA-1', '--field', 'Branch=change/CHA-1-vat-line'], 'quill');
  await page.getByText('ready').nth(0).waitFor();
  await take('branch', [doing, 0], 0.9);
  await otea(['attach', 'CHA-1', file('cart-vat.diff')], 'quill');
  await take('diff', [doing, 0], 0.9);
  await otea(['attach', 'CHA-1', file('cart-before.png'), '--role', 'before'], 'quill');
  await otea(['attach', 'CHA-1', file('cart-after.png'), '--role', 'after'], 'quill');
  await take('shots', [doing, 0], 0.9);
  await otea(
    [
      'handoff',
      'CHA-1',
      '--note',
      'Added a VAT line under the subtotal. Checked on the cart page; nothing else touched.',
    ],
    'quill',
  );
  await page.getByRole('button', { name: 'Approve' }).first().waitFor();
  await take('handed', [doing, 1], 1.4, 420);
  await stage.point(page.getByRole('button', { name: 'Approve' }).first(), [0.6, 0.6]);
  // The GIF ends here, on the Approve moment: pressing it would leave the desk on its empty
  // "Waiting for an agent..." panel, which says nothing about the loop.
  await take('approve', [doing, 1], 2.2, 420);
  await stage.context.close();

  const height = Math.round((crop.height * W) / crop.width) + CAP;
  const composer = await openComposer(browser, tokens, { width: W, height });
  const frames = [];
  for (const [i, s] of states.entries()) {
    const png = join(dir, `frame-${String(i).padStart(2, '0')}.png`);
    await composer.frame(
      `<div style="position:absolute;left:0;right:0;top:0;bottom:${CAP}px;background:var(--sheet)"></div>
       <img src="${composer.img(s.png)}" style="position:absolute;left:0;top:0;width:${W}px;display:block">${caption(s.caps[0], s.caps[1], CAP)}`,
      png,
    );
    frames.push({ png, hold: s.hold });
  }
  await composer.close();
  return { frames, colors: 96 };
}

// B: a question from an agent, answered on the phone. The phone is the picture; a small desk beside
// it only shows that it heard.
async function question({ browser, desk, scheme, dir }) {
  const { otea } = desk;
  await seedAgents(desk);
  await otea(
    [
      'create',
      '--collection',
      'Changes',
      '--title',
      'Add a coupon field to checkout',
      ...fields({
        want: 'A box on the payment step for a discount code',
        check: '- A valid code lowers the total',
        kind: 'Visual interface',
      }),
    ],
    'lumen',
  );
  await otea(['next', '--claim'], 'lumen');

  // Tall enough that the question's page, the longest one, ends inside the phone; where a page goes
  // on below the screen, it fades out there (see `fade`) instead of a line cut against the edge.
  const PHONE_H = 860;
  const phone = await openStage(browser, {
    width: 390,
    height: PHONE_H,
    scheme,
    pointer: 'finger',
    dir: join(dir, 'phone'),
  });
  const big = await openStage(browser, {
    width: 1000,
    height: 700,
    scheme,
    dir: join(dir, 'desk'),
  });
  await Promise.all([phone.page.goto(desk.link), big.page.goto(desk.link)]);
  await phone.page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await big.page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  // The phone offers to be installed on a first visit: dismissed before the first shot.
  const gotIt = phone.page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await phone.page.mouse.move(300, 760);
  const tokens = await readTokens(phone.page);

  await otea(['ask', 'CHA-1', 'Should the code apply before or after VAT?'], 'lumen');
  await phone.page.getByText('lumen asks you on CHA-1').first().waitFor();
  await big.page.getByText('Questions for you').first().waitFor();
  await big.page.getByText('lumen asks').first().waitFor();
  await big.page.mouse.move(980, 20);

  // The desk's list around Questions for you: the count and the row, small, beside the phone.
  const deskCrop = { x: 180, y: 362, width: 330, height: 106 };
  const states = [];
  const take = async (name, label, hold, fade = true) =>
    states.push({
      fade,
      phone: await phone.shot(name),
      desk: await big.shot(name, deskCrop),
      label,
      hold,
    });
  await take('asked', 'lumen is waiting for your answer', 1.4, false);

  await phone.point(phone.page.getByRole('button', { name: 'Answer' }).first());
  await phone.page.mouse.down();
  await sleep(80);
  await phone.page.mouse.up();
  const box = phone.page.locator('textarea').first();
  await box.waitFor();
  await sleep(600);
  await phone.page.mouse.move(300, 800);
  await take('open', 'lumen is waiting for your answer', 1.0);
  await box.click();
  await phone.page.keyboard.type('After VAT, on the total.', { delay: 12 });
  await take('typed', 'lumen is waiting for your answer', 1.2);
  await phone.point(phone.page.getByRole('button', { name: 'Send answer' }));
  await take('send', 'lumen is waiting for your answer', 0.8);
  await phone.page.mouse.down();
  await sleep(80);
  await phone.page.mouse.up();
  await phone.page
    .getByRole('button', { name: 'Send answer' })
    .waitFor({ state: 'detached' })
    .catch(() => {});
  await sleep(1200);
  // The page now fits the phone, so nothing fades, and the pointer rests where it covers no text.
  await phone.page.mouse.move(330, 165);
  await take('sent', 'lumen has your answer', 1.8, false);
  await phone.context.close();
  await big.context.close();

  // The picture: the phone large on the left in its frame, the small desk on the right.
  const PW = 342;
  const PH = Math.round((PW * PHONE_H) / 390);
  const DW = 262;
  const DH = Math.round((DW * deskCrop.height) / deskCrop.width);
  const height = PH + 64 + CAP;
  const composer = await openComposer(browser, tokens, { width: W, height });
  const frames = [];
  for (const [i, s] of states.entries()) {
    const png = join(dir, `frame-${String(i).padStart(2, '0')}.png`);
    const top = Math.round((height - CAP - PH) / 2);
    await composer.frame(
      `<div style="position:absolute;left:34px;top:${top}px;width:${PW}px;height:${PH}px;border-radius:30px;overflow:hidden;border:7px solid ${scheme === 'light' ? 'var(--ink)' : '#3b4254'};box-sizing:content-box;margin:-7px 0 0 -7px;box-shadow:0 18px 40px -22px rgba(20,30,60,.55)"><img src="${composer.img(s.phone)}" style="width:${PW}px;height:${PH}px;display:block">${s.fade ? `<div style="position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(to bottom,transparent,var(--ground))"></div>` : ''}</div>
       <div style="position:absolute;left:${34 + PW + 34}px;top:${top + Math.round(PH / 2) - 70}px;width:${DW}px">
         <div style="font:600 11px/1 'Schibsted Grotesk';letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:10px">On your desk</div>
         <div style="border:1px solid var(--rule-2);border-radius:10px;overflow:hidden;background:var(--ground)"><img src="${composer.img(s.desk)}" style="width:${DW}px;height:${DH}px;display:block"></div>
         <div style="margin-top:12px;font:500 15px/1.3 'Schibsted Grotesk';color:var(--ink-2)">${s.label}</div>
       </div>
       ${caption(['Answer your agents from your phone.'], 0, CAP)}`,
      png,
    );
    frames.push({ png, hold: s.hold });
  }
  await composer.close();
  return { frames, colors: 128, height };
}

// C: the Matrix. Agents size up the work, the items settle into the grid, you put one on top.
async function matrix({ browser, desk, scheme, dir }) {
  const { otea } = desk;
  await otea(['board', 'add', 'Changes', '--template', 'changes']);
  await otea(
    ['profile', '--model', 'claude-opus-5-5', '--effort', 'high', '--harness', 'claude-code'],
    'quill',
  );
  const items = [
    ['Dark mode for the shop', 'Small', 'medium'],
    ['Fix the broken newsletter link', 'Small', 'high'],
    ['Show the VAT in the cart', 'Medium', 'high'],
    ['Sort the catalogue by price', 'Large', 'medium'],
    ['Rebuild the checkout in one page', 'Huge', 'critical'],
  ];
  for (const [title] of items) {
    await otea(
      ['create', '--collection', 'Changes', '--title', title, '--field', `What I want=${title}`],
      'quill',
    );
  }
  const stage = await openStage(browser, { width: 860, height: 1500, scheme, dir });
  const { page } = stage;
  await page.goto(desk.link);
  await page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await page.goto(`${page.url().split('#')[0]}#/b/Changes`);
  await page.getByText('Matrix', { exact: true }).first().click();
  await page.locator('.mx-body').waitFor();
  await page.mouse.move(430, 1400);
  const tokens = await readTokens(page);
  // The window is tall enough for the whole Matrix, its side notes and the tray under it, so the
  // page never scrolls: every shot takes the same part of it, from the scales down.
  const top = (await page.locator('.mx-wrap').boundingBox()).y - 8;
  const crop = { x: 60, y: Math.round(top), width: 800, height: 818 };
  const align = () => sleep(600);
  const states = [];
  const take = async (name, caps, hold) => {
    await align();
    states.push({ png: await stage.shot(name, crop), caps, hold });
  };
  const sizing = ['Agents size up the work.', 'You decide what goes first.'];
  await take('unsized', [sizing, 0], 1.3);
  for (const [i, [, effort, impact]] of items.entries()) {
    await otea(
      ['update', `CHA-${i + 1}`, '--field', `Effort=${effort}`, '--field', `Impact=${impact}`],
      'quill',
    );
    if (i === 1 || i === items.length - 1)
      await take(`sized-${i}`, [sizing, 0], i === 1 ? 0.9 : 1.2);
  }
  await stage.point(
    page.getByText('Show the VAT in the cart', { exact: true }).first(),
    [0.3, 0.4],
  );
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Put on top' }).waitFor();
  await page.mouse.move(430, 1400);
  await take('picked', [sizing, 1], 1.1);
  await stage.point(page.getByRole('button', { name: 'Put on top' }));
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await page.getByText('TOP').first().waitFor();
  await page.mouse.move(430, 1400);
  // The toast that says so has to go before the shot.
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15000 });
  await take('ontop', [sizing, 1], 1.9);
  await stage.context.close();

  const height = Math.round((crop.height * W) / crop.width) + CAP;
  const composer = await openComposer(browser, tokens, { width: W, height });
  const frames = [];
  for (const [i, s] of states.entries()) {
    const png = join(dir, `frame-${String(i).padStart(2, '0')}.png`);
    await composer.frame(
      `<img src="${composer.img(s.png)}" style="position:absolute;left:0;top:0;width:${W}px;display:block">${caption(s.caps[0], s.caps[1], CAP)}`,
      png,
    );
    frames.push({ png, hold: s.hold });
  }
  await composer.close();
  return { frames, colors: 128 };
}

export const flows = {
  loop: { file: 'agent-loop', run: agentLoop },
  question: { file: 'phone-answer', run: question },
  matrix: { file: 'matrix', run: matrix },
};
