import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { repoOfItem } from '../app/gates.ts';
import type { Item } from '../app/items.ts';
import { type Launcher, shellLine, word } from '../app/launcher.ts';
import type { Project } from '../app/project.ts';
import { checkoutsOf } from '../app/repos.ts';
import { CommandFailure } from './command.ts';
import { EXIT_CODES } from './exit-codes.ts';
import { gitPath, repoRoot } from './gitrepo.ts';

// What installing or removing a hook did to its file; `content` is what was written or removed.
export type HookChange = {
  path: string;
  action: 'created' | 'updated' | 'unchanged' | 'removed' | 'absent';
  content?: string;
  // Why the hook went where it did.
  note?: string;
  // What Otea says it did, when not one of a hook's words (the forge's ruleset).
  said?: string;
};

// The first lines of the pre-push hook Otea writes; a hook without them is someone else's.
const MARK = '# otea-hook: pre-push';

// The version of the hook Otea writes now, on the line after MARK. A hook with MARK and another
// version (or none: the ones before #495, which let a push through when Otea could not check it)
// is outdated: Otea says so, and rewrites it only on otea hook install --git. Bump it whenever the
// hook's lines change what a push does.
const VERSION = '# otea-hook-version: 3';

// How a hook runs this Otea, as `otea connect` does for the MCP server.
const oteaCommand = shellLine;

// What the hook says when Otea could not check a push, and when the Otea it runs is gone.
const FAILED_LINES = [
  'Otea could not check this push of $branch (exit $code), so it does not go through: make sure otea runs here (otea check --gate push --branch $branch --repo), then push again.',
  "For the person: to push it yourself this once, git push --no-verify, which skips Otea's check. An agent never uses --no-verify.",
  'Para la persona: para subirlo tú esta vez, git push --no-verify, que se salta la revisión de Otea. Un agente nunca usa --no-verify.',
];
const NOT_FOUND_LINE =
  '  echo "otea: not found, so this push is not checked by Otea (run otea hook install --git to update the hook, or otea hook remove --git)" >&2';

const HEADER_LINE = '# Written by otea hook install --git; otea hook remove --git removes it.';

// The hooks an Otea wrote before the fail-closed one (no version line): which ref its case reads,
// whether it passes --commits, and the exit code it refuses on.
const LEGACY_HOOKS = [
  { ref: 'local_ref', commits: false, code: 1 },
  { ref: 'remote_ref', commits: false, code: 1 },
  { ref: 'remote_ref', commits: false, code: EXIT_CODES.gate_refused },
  { ref: 'remote_ref', commits: true, code: EXIT_CODES.gate_refused },
];

function legacyHook(command: string, { ref, commits, code }: (typeof LEGACY_HOOKS)[number]) {
  return `${[
    '#!/bin/sh',
    MARK,
    HEADER_LINE,
    'while read -r local_ref local_sha remote_ref remote_sha; do',
    `  case "$${ref}" in`,
    '    refs/heads/*)',
    `      ${command} check --gate push --branch "\${${ref}#refs/heads/}" --repo${commits ? ' --commits "$remote_sha..$local_sha"' : ''} < /dev/null`,
    `      if [ $? -eq ${code} ]; then exit 1; fi`,
    '      ;;',
    '  esac',
    'done',
    'exit 0',
  ].join('\n')}\n`;
}

// A word of a command line as `word` writes it: bare, or in double quotes with only ", $, ` and \
// escaped. The command a hook runs is words (after any NAME=value), never a shell operator, so a
// prefix of the person's own (`echo hi; otea`) is no launcher.
const WORD = '(?:(?:--)?[\\w=.-]+|"(?:[^"$`\\\\]|\\\\["$`\\\\])*")';
const COMMAND = new RegExp(`^(?:[A-Za-z_]\\w*=${WORD} )*${WORD}(?: ${WORD})*$`);
const MISSING_LINE = new RegExp(
  `^if ! \\{ \\[ -e ${WORD} \\](?: && \\[ -e ${WORD} \\])*; \\}; then$`,
);

// The text with line endings and trailing blanks made one.
const flat = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();

// Whether a pre-push hook is exactly one an Otea wrote, in any of its versions, bar line endings
// and trailing blanks. Each version is written again with the command (and the lines that say the
// Otea is gone) the file itself holds, which must be a plain command line, and compared whole: a
// hook with a line more, a line less or a line changed is the person's, or an edit of it.
export function isOteaOwnHook(content: string): boolean {
  return ownCommand(content) !== undefined;
}

// The command an Otea hook runs, and the lines it says its Otea is gone with, when the hook is
// exactly one an Otea wrote (isOteaOwnHook).
function ownCommand(content: string): { found: string; gone: string[] } | undefined {
  const lines = flat(content).split('\n');
  const found = lines
    .map((line) => /^ {6}(.+?) check --gate push --branch /.exec(line)?.[1])
    .find((command) => command !== undefined);
  if (found === undefined || !COMMAND.test(found)) return undefined;
  const missing = lines.findIndex((line) => line.startsWith('if ! {'));
  const gone = missing < 0 ? [] : lines.slice(missing, missing + 4);
  if (gone.length > 0 && !MISSING_LINE.test(gone[0] ?? '')) return undefined;
  const candidates = [
    ...LEGACY_HOOKS.map((legacy) => legacyHook(found, legacy)),
    modernHook(found, '# otea-hook-version: 2', []),
    modernHook(found, VERSION, gone),
  ];
  const given = flat(content);
  return candidates.some((candidate) => flat(candidate) === given) ? { found, gone } : undefined;
}

// Rewrites a pre-push hook an older Otea wrote to the current version, keeping the command it runs,
// and says its path; nothing when the hook is current, or is not exactly one an Otea wrote (a line
// of the person's, or an edit, keeps it as it is: they update it with otea hook install --git).
// The file is replaced whole by a rename, so a push that is running it reads the old one to its
// end; where the system will not rename over it (an open file on Windows) it stays as it was.
export function refreshOutdatedGitHook(cwd: string): string | undefined {
  if (gitHookKind(cwd) !== 'outdated') return undefined;
  const path = gitHookFile(cwd);
  const next = `${path}.otea-new`;
  try {
    const own = ownCommand(readFileSync(path, 'utf8'));
    if (own === undefined) return undefined;
    writeFileSync(next, modernHook(own.found, VERSION, own.gone), { mode: 0o755 });
    chmodSync(next, 0o755);
    renameSync(next, path);
    return path;
  } catch {
    rmSync(next, { force: true });
    return undefined;
  }
}

// Checks every branch the push writes to or deletes on the remote, not the local branch it sends
// from, which may be another; refuses when otea check refuses (gate_refused). It fails closed: when
// Otea fails or cannot run at all, the push stops too, saying so, with the person's way past it
// (Plan 7, item 4); only a gate nothing declares (invalid_gate: the project gates no push) lets it
// go. Tags and other refs are not branches and go unchecked. --commits names what the remote has
// and what it gets, so a push into a base branch a board protects is checked against the branches
// it brings in. Otea's language is unknown when it cannot run: the person's line is in both.
function gitCheckLines(command: string): string {
  const failed = FAILED_LINES;
  return [
    'while read -r local_ref local_sha remote_ref remote_sha; do',
    '  case "$remote_ref" in',
    '    refs/heads/*)',
    '      branch="${remote_ref#refs/heads/}"',
    `      ${command} check --gate push --branch "$branch" --repo --commits "$remote_sha..$local_sha" < /dev/null`,
    '      code=$?',
    `      if [ $code -eq ${EXIT_CODES.gate_refused} ]; then exit 1; fi`,
    `      if [ $code -ne 0 ] && [ $code -ne ${EXIT_CODES.invalid_gate} ]; then`,
    ...failed.map((line) => `        echo "${line}" >&2`),
    '        exit 1',
    '      fi',
    '      ;;',
    '  esac',
    'done',
  ].join('\n');
}

// The hook of a version that fails closed, for the command line that runs Otea and the lines that
// say it is gone (none before version 3).
function modernHook(command: string, versionLine: string, gone: readonly string[]): string {
  const header = ['#!/bin/sh', MARK, versionLine, HEADER_LINE];
  return `${[...header, ...gone, gitCheckLines(command), 'exit 0'].join('\n')}\n`;
}

function preHook(otea: Launcher): string {
  return modernHook(oteaCommand(otea), VERSION, missingOteaLines(otea));
}

// When the Otea this hook runs is gone (uninstalled, a checkout moved), the push goes through with
// one line on stderr rather than failing on a Node stack trace: a missing Otea checks nothing, and
// is not a check that failed. Only a file this hook itself names can be gone: the absolute command
// (the desktop exe) and the absolute main script, its last argument. A bare command (node, otea)
// that is not on this push's PATH is no Otea gone, and stays a failed check that refuses the push:
// a PATH is not the way past the gate.
function missingOteaLines(otea: Launcher): string[] {
  const absolute = (part: string) => win32.isAbsolute(part) || posix.isAbsolute(part);
  const main = otea.args.at(-1);
  const files = [otea.command, ...(main === undefined ? [] : [main])].filter(
    (part, index) => absolute(part) && (index === 0 || part !== otea.command),
  );
  if (files.length === 0) return [];
  return [
    `if ! { ${files.map((file) => `[ -e ${word(file)} ]`).join(' && ')}; }; then`,
    NOT_FOUND_LINE,
    '  exit 0',
    'fi',
  ];
}

// The pre-push hook of the repo at cwd, wherever core.hooksPath puts it.
export function gitHookFile(cwd: string): string {
  return gitPath(cwd, 'hooks/pre-push');
}

export function installGitHook(cwd: string, otea: Launcher): HookChange {
  let path: string;
  try {
    path = gitHookFile(cwd);
  } catch {
    throw new CommandFailure(
      'not_found',
      `${cwd} is not in a git repository: a pre-push hook goes in one (run otea hook install --git in the repo)`,
    );
  }
  const content = preHook(otea);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  if (current !== undefined && !current.includes(MARK)) {
    throw new CommandFailure(
      'already_exists',
      `${path} is another pre-push hook; Otea leaves it as it is. To gate pushes, add to it:\n\n${gitCheckLines(oteaCommand(otea))}`,
    );
  }
  const note = gitHookNote(path);
  if (current === content) return { path, action: 'unchanged', content, note };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return { path, action: current === undefined ? 'created' : 'updated', content, note };
}

// The hook names this machine's path to Otea: fine in .git/hooks, never committed, but a hooks
// folder that core.hooksPath puts in the work tree may be.
function gitHookNote(path: string): string {
  if (path.split(/[\\/]/).includes('.git')) {
    return '.git/hooks is per machine and never committed: the hook names the path to Otea on this machine';
  }
  return 'core.hooksPath puts it outside .git: do not commit it, the hook names the path to Otea on this machine';
}

// The pre-push hook of the repo at cwd: Otea's (or one of its own that runs Otea's check, as the
// lines hook install prints), one an older Otea wrote, another one, or none (none outside a repo
// too).
type GitHookKind = 'otea' | 'outdated' | 'foreign' | 'none';

function gitHookKind(cwd: string): GitHookKind {
  try {
    const path = gitHookFile(cwd);
    if (!existsSync(path)) return 'none';
    const content = readFileSync(path, 'utf8');
    if (content.includes(MARK)) return content.includes(VERSION) ? 'otea' : 'outdated';
    return content.includes('check --gate push') ? 'otea' : 'foreign';
  } catch {
    return 'none';
  }
}

// Whether the repo at cwd has Otea's pre-push hook, which makes its gates hard; false outside a
// repo. An outdated one still refuses what the gates refuse.
export function hasOteaGitHook(cwd: string): boolean {
  const kind = gitHookKind(cwd);
  return kind === 'otea' || kind === 'outdated';
}

// Whether the repo at cwd has a pre-push hook an older Otea wrote; false outside a repo.
export function hasOutdatedGitHook(cwd: string): boolean {
  return gitHookKind(cwd) === 'outdated';
}

// What Otea says of the repo at cwd when an older Otea wrote its pre-push hook, with the command
// that updates it; nothing otherwise.
export function outdatedGitHookLine(cwd: string): string | undefined {
  if (!hasOutdatedGitHook(cwd)) return undefined;
  return `${gitHookFile(cwd)} is a pre-push hook an older Otea wrote, which lets a push through when Otea cannot check it: run otea hook install --git in ${repoRoot(cwd)} to update it`;
}

// Where the repo a repo task names is checked out in the project's folders, and which of those
// checkouts have Otea's pre-push hook: a push from one without it is never checked. `foreign`: the
// checkouts with a pre-push hook of their own, which install leaves alone: Otea's check goes in it.
// `outdated`: the checkouts whose hook an older Otea wrote, which hook install updates.
export type GitHookStatus = {
  repo: string;
  installed: string[];
  missing: string[];
  foreign?: string[];
  outdated?: string[];
};

export function gitHookOf(project: Project, item: Item): GitHookStatus | undefined {
  const repo = repoOfItem(project, item);
  if (typeof repo !== 'string' || repo.trim() === '') return undefined;
  const kinds = checkoutsOf(project, repo).map((path) => ({ path, kind: gitHookKind(path) }));
  const of = (kind: GitHookKind) => kinds.filter((c) => c.kind === kind).map(({ path }) => path);
  const foreign = of('foreign');
  const outdated = of('outdated');
  return {
    repo,
    installed: of('otea'),
    missing: of('none'),
    ...(foreign.length > 0 ? { foreign } : {}),
    ...(outdated.length > 0 ? { outdated } : {}),
  };
}

// A pre-push hook that is no Otea's but runs Otea's check (as the lines hook install prints): Otea
// leaves it, and the person takes that part out.
export function foreignGitHookRunsOtea(cwd: string): string | undefined {
  try {
    const path = gitHookFile(cwd);
    if (!existsSync(path)) return undefined;
    const content = readFileSync(path, 'utf8');
    return !content.includes(MARK) && content.includes('check --gate push') ? path : undefined;
  } catch {
    return undefined;
  }
}

// `dryRun` says what would be removed, and touches nothing.
export function removeGitHook(cwd: string, dryRun = false): HookChange {
  const path = gitHookFile(cwd);
  if (!existsSync(path)) return { path, action: 'absent' };
  const content = readFileSync(path, 'utf8');
  if (!content.includes(MARK)) {
    throw new CommandFailure(
      'forbidden',
      `${path} is not Otea's pre-push hook; remove it yourself`,
    );
  }
  // A hook with Otea's mark and lines of the person's own (or edited ones) is left whole.
  if (!isOteaOwnHook(content)) {
    throw new CommandFailure(
      'forbidden',
      `${path} has Otea's mark but also lines that are not what Otea writes (edited, or yours); Otea leaves it: take Otea's check out of it yourself, or delete it`,
    );
  }
  if (!dryRun) rmSync(path);
  return { path, action: 'removed', content };
}

type HookGroup = { matcher?: string; hooks?: unknown[] };
type Settings = Record<string, unknown> & {
  hooks?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
};

// Otea no longer writes Claude Code hooks: correctness never depends on a harness. hook remove
// --claude still takes out what an older otea hook install --claude wrote (the PreToolUse gate
// that ran otea check --claude-hook, the Stop hook that ran otea topic session, and these allow
// rules), since the commands those hooks run are gone.
const CLAUDE_TOPIC_RULES: readonly string[] = [
  'Bash(otea topic add *)',
  'Bash(otea topic answer *)',
  'mcp__otea__topic_add',
  'mcp__otea__topic_answer',
];

function isOurs(hook: unknown): boolean {
  const command = (hook as { command?: unknown } | null)?.command;
  return (
    typeof command === 'string' &&
    (command.includes(' check --gate ') || command.includes(' topic session ')) &&
    command.endsWith('--claude-hook')
  );
}

// Where an older otea hook install --claude wrote its hooks.
function claudeSettingsFile(cwd: string): string {
  return join(repoRoot(cwd), '.claude', 'settings.local.json');
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  try {
    const settings: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (settings !== null && typeof settings === 'object' && !Array.isArray(settings)) {
      return settings as Settings;
    }
  } catch {}
  throw new CommandFailure(
    'invalid_fields',
    `${path} is not a JSON object; fix it, then try again`,
  );
}

// The settings with Otea's hooks (PreToolUse and Stop) taken out, and empty groups and keys with
// them.
function withoutOurs(settings: Settings): Settings {
  let hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) };
  for (const event of ['PreToolUse', 'Stop']) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.flatMap((group: HookGroup) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const left = group.hooks.filter((hook) => !isOurs(hook));
      if (left.length === group.hooks.length) return [group];
      return left.length > 0 ? [{ ...group, hooks: left }] : [];
    });
    const { [event]: _, ...others } = hooks;
    hooks = kept.length > 0 ? { ...others, [event]: kept } : others;
  }
  const { hooks: __, permissions, ...rest } = settings;
  const kept = withoutOurRules(permissions);
  const others = kept === undefined ? rest : { ...rest, permissions: kept };
  return Object.keys(hooks).length > 0 ? { ...others, hooks } : others;
}

// The permissions with Otea's allow rules taken out, and an empty allow list and permissions with
// them.
function withoutOurRules(
  permissions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (permissions === undefined || !Array.isArray(permissions.allow)) return permissions;
  const allow = permissions.allow.filter((rule) => !CLAUDE_TOPIC_RULES.includes(rule));
  const { allow: _, ...others } = permissions;
  const kept = allow.length > 0 ? { ...others, allow } : others;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function writeSettings(path: string, settings: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

// A JSON value as text with the keys of every object in order, to compare two by content.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, each: unknown) =>
    each !== null && typeof each === 'object' && !Array.isArray(each)
      ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => a.localeCompare(b)))
      : each,
  );
}

// `dryRun` says what would be removed, and touches nothing.
export function removeClaudeHook(cwd: string, dryRun = false): HookChange {
  const path = claudeSettingsFile(cwd);
  if (!existsSync(path)) return { path, action: 'absent' };
  const before = readSettings(path);
  const after = withoutOurs(before);
  // Nothing of Otea's in it: not rewritten, and not said to be removed (withoutOurs may reorder keys).
  if (canonical(after) === canonical(before)) return { path, action: 'absent' };
  // A file that held only Otea's hooks goes with them.
  if (dryRun) return { path, action: 'removed' };
  if (Object.keys(after).length === 0) rmSync(path);
  else writeSettings(path, after);
  return { path, action: 'removed' };
}
