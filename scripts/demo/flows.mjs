// The scenes. Each flow seeds a fictional project through the real CLI, then plays a short story on
// the desk: the agent's moves are real `otea` commands, the person's are pointer and keyboard.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

// Two agents with names and models, and a board with one change already under way, so the desk
// opens on a working project and not on its empty-project card (which shows where it lives).
async function seedChanges({ otea }, work = {}) {
  await otea(['board', 'add', 'Changes', '--template', 'changes', '--lang', 'en']);
  await otea(
    ['profile', '--model', 'claude-opus-5-5', '--effort', 'high', '--harness', 'claude-code'],
    'quill',
  );
  await otea(
    ['profile', '--model', 'gpt-5.5', '--effort', 'medium', '--harness', 'codex'],
    'lumen',
  );
  await otea(
    [
      'create',
      '--collection',
      'Changes',
      '--title',
      work.title ?? 'Document the export formats',
      '--field',
      `What I want=${work.want ?? 'A short page listing the formats the export can write'}`,
      '--field',
      `How I check it=${work.check ?? '- The page lists CSV, JSON and Markdown'}`,
      '--field',
      `Kind of change=${work.kind ?? 'Documentation'}`,
      '--field',
      'Effort=Small',
      '--field',
      'Impact=low',
    ],
    'lumen',
  );
  await otea(['next', '--claim'], 'lumen');
}

// A: the agent loop on the desk.
async function agentLoop({ browser, desk, scheme, framesDir, openStage, sleep }) {
  const { otea } = desk;
  await seedChanges(desk);
  await makeEvidence(browser, desk.base);
  const file = (n) => join(desk.base, n);

  const stage = await openStage(browser, { width: 1280, height: 800, scheme });
  const { page } = stage;
  await page.goto(desk.link);
  await page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await sleep(1200);
  await page.mouse.move(stage.pos.x, stage.pos.y);
  await stage.start(framesDir);

  // The agent's commands take a second each to start; the clip jumps over that wait and holds
  // on what the desk shows after it.
  const quill = (argv, hold) => stage.skip(() => otea(argv, 'quill')).then(() => sleep(hold));

  await sleep(250);
  await stage.click(page.getByText('New item', { exact: true }).first(), { ms: 300 });
  const title = page.getByPlaceholder(/What needs doing/);
  await title.waitFor();
  await sleep(100);
  await stage.click(title, { ms: 260 });
  await stage.type('Show the VAT in the cart', 9);
  await stage.click(page.locator('textarea').first(), { ms: 240 });
  await stage.type('A VAT line under the subtotal', 9);
  await stage.click(page.getByRole('button', { name: /^Create/ }).last(), { ms: 300 });
  // The pointer steps off to the empty part of the list while the agents work.
  await stage.glide(520, 700, 500);

  // Clarify: quill takes it, fills what the board asks, hands it on.
  await quill(['next', '--claim'], 600);
  await stage.skip(async () => {
    await otea(
      [
        'update',
        'CHA-2',
        '--field',
        'How I check it=- A VAT line shows under the subtotal',
        '--field',
        'Kind of change=Visual interface',
        '--field',
        'Effort=Small',
        '--field',
        'Impact=medium',
      ],
      'quill',
    );
    await otea(['handoff', 'CHA-2'], 'quill');
  });
  await sleep(500);

  // Do it: the branch, the diff and the before and after.
  await quill(['next', '--claim'], 400);
  await quill(['update', 'CHA-2', '--field', 'Branch=change/CHA-2-vat-line'], 250);
  await quill(['attach', 'CHA-2', file('cart-vat.diff')], 250);
  await quill(['attach', 'CHA-2', file('cart-before.png'), '--role', 'before'], 150);
  await quill(['attach', 'CHA-2', file('cart-after.png'), '--role', 'after'], 300);
  await quill(
    [
      'handoff',
      'CHA-2',
      '--note',
      'Added a VAT line under the subtotal. Checked on the cart page; nothing else touched.',
    ],
    800,
  );

  // The person looks and approves.
  await stage.click(page.getByRole('button', { name: 'Approve' }).first(), { ms: 400 });
  await sleep(750);
  const frames = await stage.stop();
  await stage.context.close();
  return [{ frames, from: stage.startedAt, to: stage.stoppedAt, skips: stage.skips }];
}

// B: a question from an agent, answered on the phone, seen on the desk.
async function question({ browser, desk, scheme, framesDir, openStage, sleep }) {
  const { otea } = desk;
  await seedChanges(desk, {
    title: 'Add a coupon field to checkout',
    want: 'A box on the payment step for a discount code',
    check: '- A valid code lowers the total',
    kind: 'Visual interface',
  });

  const phone = await openStage(browser, { width: 390, height: 800, scheme, cursor: 'finger' });
  const deskStage = await openStage(browser, { width: 960, height: 800, scheme, cursor: false });
  await Promise.all([phone.page.goto(desk.link), deskStage.page.goto(desk.link)]);
  await phone.page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await deskStage.page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  // The phone offers to be installed on first visit: dismissed before the clip starts.
  const gotIt = phone.page.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  // The desk has the change open, with the agent at work on it.
  await deskStage.page.getByText('Add a coupon field to checkout').first().click();
  await deskStage.page.getByRole('button', { name: 'Expand' }).click();
  await sleep(1200);
  await phone.page.mouse.move(phone.pos.x, phone.pos.y);
  await Promise.all([
    phone.start(join(framesDir, 'phone')),
    deskStage.start(join(framesDir, 'desk')),
  ]);

  await sleep(700);
  await phone.skip(() =>
    otea(['ask', 'CHA-1', 'Should the code apply before or after VAT?'], 'lumen'),
  );
  await sleep(1100);

  // On the phone: open the question and answer it.
  await phone.click(phone.page.getByText('Add a coupon field to checkout').first(), { ms: 500 });
  await sleep(500);
  await phone.click(phone.page.locator('textarea').first(), { ms: 400 });
  await phone.type('After VAT, on the total.', 24);
  await sleep(200);
  await phone.click(phone.page.getByRole('button', { name: 'Send answer' }), { ms: 400 });
  await sleep(1800);

  const [phoneFrames, deskFrames] = [await phone.stop(), await deskStage.stop()];
  await phone.context.close();
  await deskStage.context.close();
  const from = Math.max(phone.startedAt, deskStage.startedAt);
  const to = Math.min(phone.stoppedAt, deskStage.stoppedAt);
  return [
    { frames: phoneFrames, from, to, skips: phone.skips },
    { frames: deskFrames, from, to, skips: phone.skips },
  ];
}

// C: the Matrix. Agents estimate effort and impact and the items settle into the grid; the person
// puts one on top of the order agents take them in.
async function matrix({ browser, desk, scheme, framesDir, openStage, sleep }) {
  const { otea } = desk;
  await otea(['board', 'add', 'Changes', '--template', 'changes', '--lang', 'en']);
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

  const stage = await openStage(browser, { width: 1280, height: 880, scheme });
  const { page } = stage;
  await page.goto(desk.link);
  await page.getByRole('heading', { name: 'Your turn' }).first().waitFor();
  await page.goto(`${page.url().split('#')[0]}#/b/Changes`);
  await page.getByText('Matrix', { exact: true }).first().click();
  await sleep(1500);
  await page.mouse.move(stage.pos.x, stage.pos.y);
  await stage.start(framesDir);

  await sleep(900);
  // quill claims nothing: it estimates what the person left unestimated, one item at a time.
  for (const [i, [, effort, impact]] of items.entries()) {
    await stage.skip(() =>
      otea(
        ['update', `CHA-${i + 1}`, '--field', `Effort=${effort}`, '--field', `Impact=${impact}`],
        'quill',
      ),
    );
    await sleep(i === items.length - 1 ? 900 : 550);
  }
  await stage.click(page.getByText('Show the VAT in the cart', { exact: true }).first(), {
    ms: 600,
  });
  await sleep(500);
  await stage.click(page.getByRole('button', { name: 'Put on top' }), { ms: 500 });
  await sleep(1600);
  const frames = await stage.stop();
  await stage.context.close();
  return [{ frames, from: stage.startedAt, to: stage.stoppedAt, skips: stage.skips }];
}

export const flows = {
  loop: { file: 'agent-loop', width: 1000, colors: 96, run: agentLoop },
  // divider: where the phone ends in the side by side frame, in pixels (it is 390 wide)
  matrix: { file: 'matrix', width: 1000, run: matrix },
  question: { file: 'phone-answer', width: 1000, divider: 390, run: question },
};
