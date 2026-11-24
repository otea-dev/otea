import { execFileSync } from 'node:child_process';

// What a board's «Commit pushed» (Commit en main) field claims: the commit it names holds the work
// the person approved, and reached the base the board protects. The field took any text, «banana»
// or the hash of a push the hook had refused, and the item went Done (P8-F1, P9-F5), so a handoff
// that records one checks it here.

// A hash is 7 to 40 hex digits (SHA-1) or up to 64 (SHA-256); only what git resolves as a commit
// of this checkout counts as one, so a word that happens to be hex is not taken for one.
const HASH = /\b[0-9a-f]{7,64}\b/gi;
const GIT_MS = 30_000;
// A fetch asks for no password and opens no prompt: it fails, saying so, in a session nobody sees.
// Its messages are read, so git speaks English whatever the person's language is.
const QUIET = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  LC_ALL: 'C',
  LANGUAGE: 'C',
};

type Ran = { out: string } | { error: string };

function run(cwd: string, ...args: string[]): Ran {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_MS,
      env: QUIET,
    }).trim();
    return { out };
  } catch (error) {
    const lines = String((error as { stderr?: unknown }).stderr ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const line = lines.find((text) => /^(fatal|error): /.test(text)) ?? lines[0] ?? '';
    return { error: line.replace(/^(fatal|error): /, '') || `git ${args[0]} failed` };
  }
}

const git = (cwd: string, ...args: string[]): string | undefined => {
  const ran = run(cwd, ...args);
  return 'out' in ran ? ran.out : undefined;
};

const commitOf = (cwd: string, ref: string): string | undefined =>
  git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) || undefined;

// Whether a commit changes no file: against its first parent, or against nothing for a root. A
// commit git cannot read counts as changing files, never a refusal made on a guess.
// The person's own diff config (a hidden submodule, an external diff tool) must not decide it.
function changesNothing(cwd: string, commit: string): boolean {
  const parent = commitOf(cwd, `${commit}^`);
  const tree = [
    '-c',
    'diff.ignoreSubmodules=none',
    'diff-tree',
    '-r',
    '--name-only',
    '--no-ext-diff',
    '--ignore-submodules=none',
    '--no-commit-id',
  ];
  const names =
    parent === undefined ? git(cwd, ...tree, '--root', commit) : git(cwd, ...tree, parent, commit);
  return names === '';
}

// Whether `ancestor` is in the history of `ref`.
const holds = (cwd: string, ref: string, ancestor: string): boolean =>
  git(cwd, 'merge-base', '--is-ancestor', ancestor, ref) !== undefined;

// The remote a base is pushed to: the one its upstream names, else origin, else the only one.
function remoteOfBase(cwd: string, base: string): string | undefined {
  const remotes = (git(cwd, 'remote') ?? '').split(/\r?\n/).filter(Boolean);
  if (remotes.length === 0) return undefined;
  const named = git(cwd, 'config', '--get', `branch.${base}.remote`);
  if (named && remotes.includes(named)) return named;
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

// The work the person approved: what the item's handoff into review recorded (app/tips.ts).
export type ApprovedWork = { commit: string };

// What tells a commit is this item's own (P1-F3). An item that made no commit went Done writing the
// hash of main, which was another item's. `landed`: the other items of its board that really landed
// (Done), with what they wrote in the same field; a draft holding a hash proves nothing about it.
// `claimTips`: the full ids of the base's tips (local, and as the remote had it) recorded when this
// item was first claimed (claimBaseTips); what they hold was on the base before the item began.
// Without them (an older item) only `landed` is told.
export type Ownership = {
  landed: { id: string; value: string }[];
  claimTips?: string[];
};

type Named = { word: string; full: string };

// Resolves each word to the commit it names in this checkout, in one git call: a word that is no
// commit (a tree, a blob, an ambiguous or unknown id) is left out.
function commitsNamed(cwd: string, words: string[]): Map<string, string> {
  const found = new Map<string, string>();
  if (words.length === 0) return found;
  try {
    const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      cwd,
      encoding: 'utf8',
      input: `${words.map((word) => `${word}^{commit}`).join('\n')}\n`,
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: GIT_MS,
      env: QUIET,
    });
    out.split(/\r?\n/).forEach((line, at) => {
      const [full, type] = line.trim().split(' ');
      const word = words[at];
      if (word !== undefined && full && type === 'commit') found.set(word, full);
    });
  } catch {}
  return found;
}

// The tips of the base to record when an item is claimed: the local branch, and the remote-tracking
// one as this checkout last saw it (no fetch: a claim never waits on the network). Empty with no
// such branch or no repository.
export function baseTipsOf(cwd: string, base: string): string[] {
  const remote = remoteOfBase(cwd, base);
  const refs = [
    `refs/heads/${base}`,
    ...(remote === undefined ? [] : [`refs/remotes/${remote}/${base}`]),
  ];
  return [...new Set(refs.flatMap((ref) => commitOf(cwd, ref) ?? []))];
}

// What git leaves of the files when the approved commit `tip` is merged into `commit` (in memory,
// nothing is written to a branch): the merged tree equals `commit`'s own when all the approved
// change is in it already, as a rebase or squash of it onto the base leaves it. Otherwise the files
// the merge would still change, or `conflicts` when git cannot merge the two cleanly (they changed
// the same lines differently). git finds the merge base itself, several of them included.
type Merged = { same: true } | { files: string[] } | { conflicts: true } | undefined;

function mergedInto(cwd: string, tip: string, commit: string): Merged {
  let out: string;
  try {
    out = execFileSync('git', ['merge-tree', '--write-tree', '--no-messages', commit, tip], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_MS,
      env: QUIET,
    });
  } catch (error) {
    const { status } = error as { status?: number | null };
    return status === 1 ? { conflicts: true } : undefined;
  }
  const merged = out.split(/\r?\n/)[0]?.trim();
  const own = git(cwd, 'rev-parse', '--verify', '--quiet', `${commit}^{tree}`);
  if (!merged || !own) return undefined;
  if (merged === own) return { same: true };
  const files = git(cwd, 'diff-tree', '-r', '--name-only', '--no-renames', own, merged) ?? '';
  return { files: files.split(/\r?\n/).filter(Boolean) };
}

// What `lackOf` needs to tell why a commit is earlier than the approved work.
type Context = {
  // The base as it stands (the remote's, else the local branch) and whether it holds the approved
  // commit; the base tips recorded when the item was first claimed, when there are any.
  baseHoldsTip: boolean;
  claimTips?: string[] | undefined;
};

// Why a commit does not hold the approved commit's work, or undefined when it does. It holds it
// when the approved commit is in its history (a merge of the base into the branch, then a
// fast-forward, always), or when git merging the approved commit into it changes nothing: all the
// approved change is in it at the same result, as a rebase or squash onto a base that moved leaves
// it. The approved change must not be empty from where the two diverged, or any commit built on that
// point would pass for holding it. A rebase whose conflict was resolved by hand does not merge back
// cleanly and is refused: land by merging the base into the branch, so the resolution is reviewed.
// The text names the real cause of each refusal.
function lackOf(cwd: string, tip: string, commit: string, context: Context): string | undefined {
  if (holds(cwd, commit, tip)) return undefined;
  const short = tip.slice(0, 7);
  const bases = (git(cwd, 'merge-base', '--all', tip, commit) ?? '').split(/\r?\n/).filter(Boolean);
  if (bases.length === 0) {
    return `it shares no history with it, so it is another line of work than the approved one.`;
  }
  // The commit is part of the approved work's own history: older than it.
  if (holds(cwd, tip, commit)) {
    if (context.baseHoldsTip) {
      return `it is an older commit of {base}: the approved work is on {base} at a later commit.`;
    }
    if (context.claimTips?.some((claimed) => holds(cwd, claimed, commit))) {
      return `it is an older commit of {base}, from before this item began.`;
    }
    const part = `only part of the approved work: {base} was brought to ${commit.slice(0, 7)}, an earlier commit than ${short}, so the commits after it are not on {base} (a partial landing). Push the rest (the approved branch fast-forwarded into {base}) and write the hash of the last commit.`;
    return context.claimTips === undefined
      ? `it is an older commit of {base}, from before the approved work, or ${part}`
      : `it is ${part}`;
  }
  // The approved change as git sees it from each point the two diverged: with none, nothing to hold.
  const trees = bases.map((base) => git(cwd, 'rev-parse', `${base}^{tree}`));
  const tipTree = git(cwd, 'rev-parse', `${tip}^{tree}`);
  const emptyFrom = bases.find((_, at) => trees[at] === tipTree);
  if (emptyFrom !== undefined) {
    return `the approved work leaves the files as they were at ${emptyFrom.slice(0, 7)}, where it and this commit diverged, so it has no change this commit could be told to hold.`;
  }
  const merged = mergedInto(cwd, tip, commit);
  if (merged === undefined) {
    return `git could not compare it with the approved work (${short}).`;
  }
  if ('same' in merged) return undefined;
  if ('conflicts' in merged) {
    return `it does not hold the approved commit and git cannot merge the two: they changed the same lines differently (a rebase with a conflict resolved by hand, or other work on {base}), so what it landed is not what was reviewed. Land by merging {base} into the approved branch (git merge origin/{base}), so the approved commit is in its history, push the branch, then fast-forward {base} to it; if the merge conflicts, send the item back to the step before this one so the resolution is reviewed.`;
  }
  const shown = merged.files.slice(0, 3).join(', ');
  const more = merged.files.length > 3 ? ` and ${merged.files.length - 3} more` : '';
  return `part of the approved change is missing from it: merging ${short} into it would still change ${shown}${more}. Land the approved commit itself (merge {base} into the approved branch, push it, then fast-forward {base} to it).`;
}

// The refusal of the commits that hold the work when none of them can be this item's: each is
// another item's that landed already, or was on the base before this item was first claimed (so it
// is reachable from a tip recorded then). One commit of its own among them is enough: the others
// are context ("follows 9f8e7d6"). Undefined when one is its own.
function notItsOwn(
  cwd: string,
  name: string,
  holding: Named[],
  taken: Map<string, string>,
  own: Ownership,
): string | undefined {
  const why = ({ word, full }: Named): string | undefined => {
    const holder = taken.get(full);
    if (holder !== undefined) {
      return `${name}: commit ${word} is already the commit ${holder} landed with, so it is not this item's work. Commit this item's own change and write the hash of that commit (git rev-parse --short HEAD).`;
    }
    if ((own.claimTips ?? []).some((tip) => holds(cwd, tip, full))) {
      return `${name}: commit ${word} was already on the base when this item was taken, so it is not this item's work. Commit this item's own change and write the hash of that commit (git rev-parse --short HEAD).`;
    }
    return undefined;
  };
  const refusals = holding.map(why);
  return refusals.some((each) => each === undefined) ? undefined : refusals[0];
}

// The refusal of a handoff whose `name` field does not hold a commit of `base` as it stands now, or
// undefined when it does. Every commit it names must be in the base: with a remote, on the remote's
// branch of it as the remote has it now (a fetch, then git branch -r --contains), since a push a
// hook refused is not there; with none, in the local base. At least one must hold the work the
// person approved (the approved commit in its history, or all it changes in the commit, as a rebase
// or a squash leaves it), so an older commit of the base, such as git rev-parse origin/main before
// any push, is no proof. When the remote cannot be reached it fails closed. Never throws.
export function landedCommitRefusal(
  cwd: string,
  name: string,
  value: string,
  base: string,
  approved?: ApprovedWork,
  own: Ownership = { landed: [] },
): string | undefined {
  const words = [...new Set((value.match(HASH) ?? []).map((id) => id.toLowerCase()))];
  const said = `${name} says "${value.trim().slice(0, 60)}"`;
  if (words.length === 0) {
    return `${said}, which is no commit: write the short hash of the commit of ${base} (git rev-parse --short ${base}).`;
  }
  // The hashes of this value and of the items that landed, resolved in one git call.
  const written = own.landed.map(({ value: text }) => [
    ...new Set((text.match(HASH) ?? []).map((id) => id.toLowerCase())),
  ]);
  const resolved = commitsNamed(cwd, [...new Set([...words, ...written.flat()])]);
  const commits = words.flatMap((word) => {
    const full = resolved.get(word);
    return full === undefined ? [] : [{ word, full }];
  });
  if (commits.length === 0) {
    return `${name}: no commit ${words[0]} in this checkout. Write the short hash of the commit of ${base} (git rev-parse --short ${base}), from the checkout that has it.`;
  }
  const listed = commits.map((each) => each.word).join(', ');
  const remote = remoteOfBase(cwd, base);
  const upstream = remote === undefined ? undefined : `${remote}/${base}`;
  let noRemoteBase = false;
  if (remote !== undefined) {
    const fetched = run(
      cwd,
      'fetch',
      '--quiet',
      '--no-tags',
      remote,
      `+refs/heads/${base}:refs/remotes/${remote}/${base}`,
    );
    // A remote with no base branch holds nothing, whatever an old remote-tracking ref of it still
    // says: the commits below are then not pushed.
    noRemoteBase = 'error' in fetched && /couldn't find remote ref/i.test(fetched.error);
    if ('error' in fetched && !noRemoteBase) {
      return `${name}: could not reach ${remote} (${fetched.error}), so Otea cannot tell whether ${listed} is on ${upstream}. Check the connection and hand it off again in a moment.`;
    }
  }
  const local = commitOf(cwd, `refs/heads/${base}`);
  if (remote !== undefined && noRemoteBase) {
    return `${name}: ${remote} has no ${base} branch, so ${listed} is not pushed. Push it first (git push ${remote} ${base}), then hand it off again.`;
  }
  for (const { word, full } of commits) {
    if (upstream === undefined) {
      if (local === undefined) {
        return `${name}: this checkout has no ${base}, so ${word} cannot be one of its commits.`;
      }
      if (!holds(cwd, local, full)) {
        return `${name}: commit ${word} is not in ${base}. Write the hash of a commit that is (git rev-parse --short ${base}).`;
      }
      continue;
    }
    const onRemote = (git(cwd, 'branch', '-r', '--contains', full) ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(upstream);
    if (onRemote) continue;
    if (local !== undefined && holds(cwd, local, full)) {
      return `${name}: commit ${word} is in your local ${base} but not on ${upstream}, so it is not pushed. Push it first (git push ${remote} ${base}); a push the hook refused did not reach ${remote}. Then hand it off again.`;
    }
    return `${name}: commit ${word} is not on ${upstream}. Write the hash of a commit of ${base} that is pushed (git rev-parse --short ${upstream}).`;
  }
  // The commits that hold the work the person approved (with none approved, those it names): only
  // they have to be this item's own, a hash named as context ("follows 9f8e7d6") is not judged.
  let holding = commits;
  if (approved !== undefined) {
    const tip = commitOf(cwd, approved.commit);
    if (tip === undefined) {
      return `${name}: this checkout lacks the commit the person approved (${approved.commit.slice(0, 7)}), so it cannot tell that ${listed} holds it. Fetch it, then hand it off again.`;
    }
    const baseRef = upstream ?? `refs/heads/${base}`;
    const context: Context = {
      baseHoldsTip: holds(cwd, baseRef, tip),
      claimTips: own.claimTips,
    };
    const lacks = commits.map((each) => ({ ...each, why: lackOf(cwd, tip, each.full, context) }));
    holding = lacks.filter(({ why }) => why === undefined);
    const [unheld] = lacks;
    if (holding.length === 0 && unheld?.why !== undefined) {
      return `${name}: ${listed} does not hold the work the person approved (${tip.slice(0, 7)}): ${unheld.why.replaceAll('{base}', base)} Write the hash of the commit where that work landed (git rev-parse --short ${base} once it is there).`;
    }
  }
  // A commit that changes no file (git commit --allow-empty) is a new hash of the base with no work
  // in it (P1-F2). Only commits that change something are judged for being this item's own: an
  // empty one beside another item's commit must not pass for the item's.
  const [first] = holding;
  holding = holding.filter(({ full }) => !changesNothing(cwd, full));
  if (holding.length === 0 && first) {
    return `${name}: commit ${first.word} changes no files, so it is no work landed (a commit made with git commit --allow-empty is a new hash and nothing else). Commit this item's own change and write the hash of that commit (git rev-parse --short HEAD).`;
  }
  const taken = new Map<string, string>();
  own.landed.forEach(({ id }, at) => {
    for (const word of written[at] ?? []) {
      const full = resolved.get(word);
      if (full !== undefined && !taken.has(full)) taken.set(full, id);
    }
  });
  return notItsOwn(cwd, name, holding, taken, own);
}
