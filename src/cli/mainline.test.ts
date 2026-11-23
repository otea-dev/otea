import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getItem, updateItem } from '../app/items.ts';
import { claimItem } from '../app/leases.ts';
import { approveItem, liveBoardOf } from '../app/next.ts';
import { openProject } from '../app/project.ts';
import { stateOf } from '../core/board/engine.ts';
import { updateItemState } from '../store/queries.ts';
import { type Cli, cliAt, declareProfiles, tempGitRepo } from './testing.ts';

// «No subas nada sin que lo vea» on a project kept on main (P2S-R2-1): the Code on main board
// refuses a push of main until the person approves the item, then lets the approved main go.
describe('the Code on main board', () => {
  let repo: ReturnType<typeof tempGitRepo>;
  let otea: Cli;
  let id: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo.dir,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  const change = (file: string, text: string) => {
    writeFileSync(join(repo.dir, file), text);
    git('add', file);
    git('commit', '-q', '-m', file);
  };
  const pushMain = () => otea('check', '--gate', 'push', '--branch', 'main');

  // An item of Código, its Rama main, being done in Hacerlo (or in `step`).
  const doing = async (title: string, step = 'Hacerlo') => {
    const created = await otea(
      'create',
      '--collection',
      'Código',
      '--title',
      title,
      '--field',
      'Qué quiero=x',
      '--field',
      'Rama=main',
      '--json',
    );
    const made: string = JSON.parse(created.out).id;
    moveTo(made, step);
    return made;
  };
  // Puts an item in `step`, being done, as if it had got there.
  const moveTo = (item: string, step: string) => {
    const project = openProject(repo.dir);
    try {
      const doit = liveBoardOf(project, 'Código')?.def.steps.find(({ name }) => name === step);
      if (!doit) throw new Error(`no ${step}`);
      updateItemState(
        project.db,
        item,
        stateOf({ step: doit.id, phase: 'doing' }),
        '2026-11-19T10:00:00Z',
      );
    } finally {
      project.db.close();
    }
  };
  const approve = (item: string) => {
    const project = openProject(repo.dir);
    try {
      approveItem(project, { id: item, actor: { kind: 'human', name: 'lucia' }, channel: 'ui' });
    } finally {
      project.db.close();
    }
  };

  beforeEach(async () => {
    repo = tempGitRepo();
    otea = cliAt(repo.dir, { OTEA_AGENT: 'lu' });
    const person = cliAt(repo.dir);
    await person('init', '--template', 'none');
    const added = await person('board', 'add', 'Código', '--template', 'mainline');
    expect(added.code, added.err).toBe(0);
    declareProfiles(repo.dir, 'lu');
    change('bot.py', 'print(1)\n');
    git('branch', '-M', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    id = await doing('Regar');
  });

  afterEach(() => repo.remove());

  // Told by an agent to run otea approve, the person got «Name yourself first…» (P2S-R3-7).
  it('tells the person running approve that approving is theirs, in the desk', async () => {
    const person = cliAt(repo.dir);
    const tried = await person('approve', id);
    expect(tried.code).not.toBe(0);
    expect(tried.err).toContain(
      `Approving ${id} is the person's, in the desk: open ${id} there (otea serve gives its address) and approve it or send it back. An agent never approves a step the person reviews.`,
    );
    const back = await person('send-back', id, '--reason', 'no');
    expect(back.err).toContain(`Sending ${id} back is the person's, in the desk`);
  });

  it('refuses a push of main until the person approves, then lets only the approved main go', async () => {
    const claimed = await otea('claim', id);
    expect(claimed.code, claimed.err).toBe(0);
    change('bot.py', 'print(2)\n');
    const early = await pushMain();
    expect(early.code).toBe(19);
    expect(early.out).toContain(`${id} is in Hacerlo`);

    writeFileSync(join(repo.dir, 'regar.diff'), 'diff --git a/bot.py b/bot.py\n');
    expect((await otea('attach', id, 'regar.diff')).code).toBe(0);
    expect((await otea('handoff', id, '--note', 'regar')).code).toBe(0);
    expect((await pushMain()).code).toBe(19);

    approve(id);
    expect(await pushMain()).toMatchObject({ code: 0 });

    change('extra.py', 'never reviewed\n');
    expect((await pushMain()).code).toBe(19);
  });

  // The person's own commit on a protected main got the agents' refusal, in English, with no way
  // out (P2S-R3-4): the refusal also speaks to the person, in the board's language.
  it('tells the person, in the board language, how to land a commit of their own', async () => {
    change('TODO.md', '- regar\n');
    const refused = await pushMain();
    expect(refused.code).toBe(19);
    expect(refused.out).toContain(
      'Para la persona: si el commit es tuyo, pásalo por el tablero (pídele a tu agente un ítem y apruébalo en Otea) o súbelo tú esta vez con git push --no-verify, que se salta la revisión de Otea. Un agente nunca usa --no-verify.',
    );
  });

  // A request with no code change (installing the hook, a question) could not be handed off on a
  // main-only board: «Rama main has no commits over origin/HEAD» (P2S-R3-3). It goes to review as
  // no code change, says so, and a push of main never waits on it.
  it('hands off an item that made no commit, says so, and never holds the push gate for it', async () => {
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    expect((await otea('claim', id)).code).toBe(0);
    writeFileSync(join(repo.dir, 'regar.diff'), 'no changes\n');
    expect((await otea('attach', id, 'regar.diff')).code).toBe(0);
    const handed = await otea('handoff', id, '--note', 'hook installed, nothing to commit');
    expect(handed.code, handed.err).toBe(0);
    expect(handed.out).toContain(
      `${id} goes to review with no commit: main holds nothing the remote lacks, so the person reviews no code change and the push gate does not wait on it.`,
    );

    const other = await doing('Riego doble');
    expect((await otea('claim', other)).code).toBe(0);
    change('bot.py', 'print(3)\n');
    expect((await otea('attach', other, 'regar.diff')).code).toBe(0);
    expect((await otea('handoff', other, '--note', 'riego')).code).toBe(0);
    approve(other);
    expect(await pushMain()).toMatchObject({ code: 0 });
  });

  // Rama had to be typed «main» on every item (P2S-R3-10): it starts there. An item still being
  // clarified made no commit on main, so a push of main never waits on it.
  it('starts a new item on main, and never holds a push of main while it is clarified', async () => {
    const asked = await otea(
      'create',
      '--collection',
      'Código',
      '--title',
      'Otro pedido',
      '--field',
      'Qué quiero=y',
      '--json',
    );
    expect(asked.code, asked.err).toBe(0);
    const fresh = JSON.parse(asked.out);
    expect(fresh.fields).toContainEqual(expect.objectContaining({ name: 'Rama', value: 'main' }));
    expect(fresh.stateName).toBe('Aclarar');

    expect((await otea('claim', id)).code).toBe(0);
    change('bot.py', 'print(2)\n');
    writeFileSync(join(repo.dir, 'regar.diff'), 'diff --git a/bot.py b/bot.py\n');
    expect((await otea('attach', id, 'regar.diff')).code).toBe(0);
    expect((await otea('handoff', id, '--note', 'regar')).code).toBe(0);
    approve(id);
    expect(await pushMain()).toMatchObject({ code: 0 });
  });

  // P8-F1, P9-F5: the Subir step took «banana» as Commit subido, and the hash of a push the hook
  // had refused, and the item went Done with nothing on the remote. It takes a commit of main,
  // and where the repo has a remote, one that is on it.
  it('closes Subir only with a commit of main, on the remote when the repo has one', async () => {
    const landing = await doing('Regar', 'Subir');
    expect((await otea('claim', landing)).code).toBe(0);
    const put = (value: string) => otea('update', landing, '--field', `Commit subido=${value}`);
    const handoff = () => otea('handoff', landing);

    // No remote: main is where it ends, and a hash of it is the proof.
    expect((await put('banana')).code).toBe(0);
    const text = await handoff();
    expect(text.code).not.toBe(0);
    expect(text.err).toContain(`${landing} not handed off: Commit subido says "banana"`);
    // Naming the way out does not skip the check: --way Done is the same handoff.
    const way = await otea('handoff', landing, '--way', 'Done');
    expect(way.code).not.toBe(0);
    expect(way.err).toContain(`${landing} not handed off: Commit subido says "banana"`);
    expect((await put('deadbeef')).code).toBe(0);
    expect((await handoff()).err).toContain('no commit deadbeef in this checkout');

    // With a remote, a commit of the local main that was never pushed is not landed.
    const origin = mkdtempSync(join(tmpdir(), 'otea-origin-'));
    execFileSync('git', ['init', '--quiet', '--bare', origin], { stdio: 'ignore' });
    git('remote', 'add', 'origin', origin);
    change('bot.py', 'print(5)\n');
    const local = git('rev-parse', '--short', 'HEAD');
    expect((await put(local)).code).toBe(0);
    const unpushed = await handoff();
    expect(unpushed.code).not.toBe(0);
    // A new remote with nothing on it: it has no main at all, whatever this checkout last saw.
    expect(unpushed.err).toContain(`origin has no main branch, so ${local} is not pushed`);
    expect(unpushed.err).toContain('git push origin main');

    git('push', '-q', 'origin', 'main');
    const closed = await handoff();
    expect(closed.code, closed.err).toBe(0);
    expect(closed.out).toContain(`${landing} is Done`);
    rmSync(origin, { recursive: true, force: true, maxRetries: 10 });
  });

  // P1-F3: an item that made no commit went Done writing the hash of main, which was the commit of
  // another item. The commit it writes is its own: not one an item that landed wrote (though a
  // draft holding the hash counts for nothing), and not one the base held when it was claimed.
  it('closes Subir only with a commit of its own, not another item’s', async () => {
    const put = (item: string, value: string) =>
      otea('update', item, '--field', `Commit subido=${value}`);
    // The board takes its items one at a time, in the order they were asked.
    const first = id;
    const second = await doing('Riego doble');
    const third = await doing('Otro riego');
    const draft = await doing('Borrador');
    expect((await otea('claim', first)).code).toBe(0);
    change('regar.py', 'print(2)\n');
    const head = git('rev-parse', '--short', 'HEAD');
    // A draft that wrote the same hash does not keep its real author from landing.
    const project = openProject(repo.dir);
    try {
      updateItem(project, {
        id: draft,
        fields: { 'Commit subido': head },
        actor: { kind: 'human', name: 'lucia' },
      });
    } finally {
      project.db.close();
    }
    moveTo(first, 'Subir');
    expect((await otea('claim', first)).code).toBe(0);
    expect((await put(first, head)).code).toBe(0);
    const landed = await otea('handoff', first);
    expect(landed.code, landed.err).toBe(0);

    // second, taken after it, writes the commit first landed with.
    const taken = await otea('claim', second);
    expect(taken.code, taken.err).toBe(0);
    moveTo(second, 'Subir');
    expect((await otea('claim', second)).code).toBe(0);
    expect((await put(second, head)).code).toBe(0);
    const reused = await otea('handoff', second);
    expect(reused.code).not.toBe(0);
    expect(reused.err).toContain(
      `${second} not handed off: Commit subido: commit ${head} is already the commit ${first} landed with`,
    );
    change('riego.py', 'print(3)\n');
    expect((await put(second, git('rev-parse', '--short', 'HEAD'))).code).toBe(0);
    const done = await otea('handoff', second);
    expect(done.code, done.err).toBe(0);

    // A commit already on main when the item was claimed is not its work, whoever made it.
    git('commit', '-q', '--allow-empty', '-m', 'old');
    const old = git('rev-parse', '--short', 'HEAD');
    expect((await otea('claim', third)).code).toBe(0);
    moveTo(third, 'Subir');
    expect((await otea('claim', third)).code).toBe(0);
    expect((await put(third, old)).code).toBe(0);
    const before = await otea('handoff', third);
    expect(before.code).not.toBe(0);
    expect(before.err).toContain(`commit ${old} was already on the base when this item was taken`);

    // Its own commit, made after it was claimed, closes it.
    change('otro.py', 'print(4)\n');
    expect((await put(third, git('rev-parse', '--short', 'HEAD'))).code).toBe(0);
    const own = await otea('handoff', third);
    expect(own.code, own.err).toBe(0);
    expect(own.out).toContain(`${third} is Done`);
  });

  // Only the item's first claim tells what was on main before it: the claim of the landing step
  // comes after the agent's own commit, whose tips hold it, and must not refuse that commit.
  it('takes the own commit of an item whose first claim recorded no tips, though a later claim did', async () => {
    const project = openProject(repo.dir);
    try {
      claimItem(project, { id, actor: { kind: 'agent', name: 'lu' } });
    } finally {
      project.db.close();
    }
    change('regar.py', 'print(2)\n');
    const head = git('rev-parse', '--short', 'HEAD');
    expect((await otea('release', id)).code).toBe(0);
    moveTo(id, 'Subir');
    // The landing step's claim: it records the tips, and they hold head.
    expect((await otea('claim', id)).code).toBe(0);
    const read = openProject(repo.dir);
    try {
      const claims = getItem(read, id).events.filter(({ type }) => type === 'claimed');
      expect(claims.map(({ data }) => data.baseTips)).toEqual([
        undefined,
        [git('rev-parse', 'HEAD')],
      ]);
    } finally {
      read.db.close();
    }
    expect((await otea('update', id, '--field', `Commit subido=${head}`)).code).toBe(0);
    const landed = await otea('handoff', id);
    expect(landed.code, landed.err).toBe(0);
    expect(landed.out).toContain(`${id} is Done`);
  });

  // P1-F2: the board says to work on main with no branch, and the notice said to make a worktree
  // of its own: three agents committing in one checkout broke the index and one handed off
  // another's commit. The board takes one agent at a time on main, and the notice agrees.
  it('takes one agent at a time on main, and tells the agent so instead of sending it to a worktree', async () => {
    declareProfiles(repo.dir, 'lu', 'mo');
    const mo = cliAt(repo.dir, { OTEA_AGENT: 'mo' });
    const other = await doing('Riego doble');
    expect((await mo('claim', id)).code).toBe(0);

    const refused = await otea('claim', other);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain(
      `${other} not claimed: mo works on main with ${id} now (its lease runs until `,
    );
    expect(refused.err).toContain(
      `, and ${other} waits for it: this board works straight on main, so one agent at a time`,
    );
    expect(refused.err).toContain('Items that do not work on main can be taken now: otea next.');

    // Another agent holds work on some other board: the notice does not send this one to a worktree.
    await mo('release', id);
    const person = cliAt(repo.dir);
    expect((await person('board', 'add', 'Tareas', '--template', 'todos')).code).toBe(0);
    const todo = await otea(
      'create',
      '--collection',
      'Tareas',
      '--title',
      'Regar',
      '--field',
      'Qué hace falta=regar',
      '--json',
    );
    expect(todo.code, todo.err).toBe(0);
    expect((await mo('claim', JSON.parse(todo.out).id)).code, todo.err).toBe(0);
    const claimed = await otea('claim', id);
    expect(claimed.code, claimed.err).toBe(0);
    expect(claimed.out).toContain('no branch and no worktree');
    expect(claimed.out).not.toContain('git worktree add');
  });
});
