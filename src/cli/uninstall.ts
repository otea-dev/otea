import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { removeAgentsMd } from '../app/agents.ts';
import { listProjects, withRegistry } from '../app/home.ts';
import { gitCommonDir, oteaDir } from '../app/project.ts';
import { reposInside } from '../app/repos.ts';
import { CommandFailure } from './command.ts';
import { inspectServer, stopServer, unresponsiveText } from './daemon.ts';
import { checkoutRoot } from './gitrepo.ts';
import { foreignGitHookRunsOtea, removeClaudeHook, removeGitHook } from './hooks.ts';

// What `otea uninstall` did to one thing Otea put on the machine, or would do under --dry-run.
export type Step = {
  what: 'git-hook' | 'claude-hooks' | 'agents-md' | 'server' | 'data';
  path?: string;
  // Whether it changed (or would) something; false when there was nothing of Otea's there.
  changed: boolean;
  // Something of the person's that Otea left on purpose, and says so.
  kept?: true;
  text: string;
};

const said = (dryRun: boolean, past: string, would: string) => (dryRun ? would : past);

// Every checkout whose files Otea writes: the one at cwd, and the main one when cwd is a linked
// worktree (each has its own AGENTS.md).
function checkouts(cwd: string): string[] {
  const top = checkoutRoot(cwd);
  if (top === undefined) return [];
  const common = gitCommonDir(cwd);
  const main = common === undefined ? undefined : dirname(common);
  const same = (a: string, b: string) =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  return main === undefined || same(main, top) ? [top] : [top, main];
}

export function inRepo(cwd: string): boolean {
  return checkoutRoot(cwd) !== undefined;
}

// What a repo gets back from otea init and otea connect: the pre-push hook, the Claude Code hooks
// an older Otea wrote, and the block in AGENTS.md. Only what carries Otea's mark goes; every other
// hook, rule and line of the file stays. A folder that is no repo (a project over several repos)
// has only the block.
function uninstallFolder(cwd: string, dryRun: boolean): Step[] {
  const steps: Step[] = [];
  const remove = (verb: string) => said(dryRun, `Removed ${verb}`, `Would remove ${verb}`);
  const repo = inRepo(cwd);

  if (repo) {
    steps.push(...uninstallGit(cwd, dryRun, remove));
  }
  const root = checkoutRoot(cwd) ?? resolve(cwd);
  const agents = removeAgentsMd(root, dryRun);
  steps.push({
    what: 'agents-md',
    path: agents.path,
    changed: agents.action !== 'absent',
    text:
      agents.action === 'absent'
        ? `No Otea block in ${agents.path}`
        : agents.action === 'deleted'
          ? remove(`${agents.path}, which held only Otea's block`)
          : remove(`Otea's block from ${agents.path}`),
  });
  return steps;
}

function uninstallGit(cwd: string, dryRun: boolean, remove: (verb: string) => string): Step[] {
  const steps: Step[] = [];
  try {
    const hook = removeGitHook(cwd, dryRun);
    steps.push(
      hook.action === 'removed'
        ? {
            what: 'git-hook',
            path: hook.path,
            changed: true,
            text: remove(`the pre-push hook ${hook.path}`),
          }
        : {
            what: 'git-hook',
            path: hook.path,
            changed: false,
            text: `No Otea pre-push hook at ${hook.path}`,
          },
    );
  } catch (error) {
    if (!(error instanceof CommandFailure)) throw error;
    const path = foreignGitHookRunsOtea(cwd);
    steps.push({
      what: 'git-hook',
      changed: false,
      kept: true,
      text:
        path === undefined
          ? "Left the pre-push hook: it is not Otea's"
          : `Left ${path}: it is another pre-push hook, with Otea's check in it; take those lines out yourself`,
    });
  }

  try {
    const claude = removeClaudeHook(cwd, dryRun);
    steps.push({
      what: 'claude-hooks',
      path: claude.path,
      changed: claude.action === 'removed',
      text:
        claude.action === 'removed'
          ? remove(`the Otea hooks and allow rules in ${claude.path}`)
          : `No Otea hooks in ${claude.path}`,
    });
  } catch (error) {
    if (!(error instanceof CommandFailure)) throw error;
    steps.push({
      what: 'claude-hooks',
      changed: false,
      kept: true,
      text: `Left it: ${error.message}`,
    });
  }

  return steps;
}

// The folders `otea uninstall` goes through: the repo at cwd with all its worktrees (each has its
// own AGENTS.md), then every folder the registry links to a project, a repo or a folder over
// several repos (and the repos and worktrees below it): the projects Otea was set up in. Each once.
// A registered folder that is gone is skipped, and said.
export function repoTargets(cwd: string): { targets: string[]; missing: string[] } {
  const seen = new Set<string>();
  const targets: string[] = [];
  const missing: string[] = [];
  const add = (path: string) => {
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(path);
  };
  const addRepo = (path: string) => {
    add(path);
    for (const tree of worktreesOf(path)) add(tree);
  };
  if (inRepo(cwd)) addRepo(checkoutRoot(cwd) ?? resolve(cwd));
  const projects = withRegistry(process.env, listProjects) ?? [];
  for (const { paths } of projects) {
    for (const { path, kind } of paths) {
      if (!existsSync(path)) {
        missing.push(path);
        continue;
      }
      if (kind === 'repo') addRepo(path);
      else {
        add(resolve(path));
        for (const repo of reposInside(path)) addRepo(resolve(repo));
      }
    }
  }
  return { targets, missing: [...new Set(missing)] };
}

// The checkouts of the repo at `path`, the main one and every linked worktree that still exists.
function worktreesOf(path: string): string[] {
  try {
    const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: path,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return listed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => resolve(line.slice('worktree '.length)))
      .filter((tree) => existsSync(tree));
  } catch {
    return [];
  }
}

export type RepoReport = { path: string; steps: Step[] };

// Takes Otea's files out of every folder repoTargets names. A shared file (the hooks of a repo's
// worktrees) is told once.
export function uninstallRepos(
  cwd: string,
  dryRun: boolean,
): { reports: RepoReport[]; missing: string[] } {
  const { targets, missing } = repoTargets(cwd);
  const told = new Set<string>();
  const reports = targets.map((path) => {
    const steps = uninstallFolder(path, dryRun).filter((step) => {
      if (step.path === undefined) return true;
      const key = `${step.what}:${step.path.toLowerCase()}`;
      if (told.has(key)) return false;
      told.add(key);
      return true;
    });
    return { path, steps };
  });
  return { reports, missing };
}

// Ends this Otea home's server, as otea serve stop does: by its process id, once it is known to be
// this home's. Nothing running is no change. A server that cannot be ended is a failure, said in
// the step.
export async function uninstallServer(
  home: string,
  main: string,
  dryRun: boolean,
): Promise<Step & { failed?: true }> {
  const none: Step = { what: 'server', changed: false, text: 'No otea serve is running' };
  try {
    if (dryRun) {
      const state = await inspectServer(home);
      if (state.kind === 'running') {
        const { pid, port } = state;
        return {
          what: 'server',
          changed: true,
          text: `Would stop otea serve (pid ${pid}, port ${port})`,
        };
      }
      if (state.kind === 'unresponsive') {
        return {
          what: 'server',
          changed: false,
          text: `${unresponsiveText(state)}; a real run would try to end it`,
        };
      }
      // A dry run changes nothing, not even the record of a server that ended.
      return none;
    }
    const result = await stopServer(home, main);
    if (!result) return none;
    if ('stale' in result) {
      return {
        what: 'server',
        changed: false,
        text: `No otea serve is running: removed the record of ${result.stale.pid}, which is no server of this Otea home`,
      };
    }
    const { pid, port } = result.stopped;
    return {
      what: 'server',
      changed: true,
      text: `Stopped otea serve (pid ${pid}, port ${port})`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      what: 'server',
      changed: false,
      failed: true,
      text: `Could not stop otea serve: ${reason}`,
    };
  }
}

// A folder is Otea's home when it holds what Otea keeps there; any other folder OTEA_HOME names
// is left alone, whatever it is.
const HOME_MARKS = ['registry.db', 'data', 'serve.json', 'ui-token'];

function looksLikeHome(home: string): boolean {
  return HOME_MARKS.some((name) => existsSync(join(home, name)));
}

// Whether `path` is `folder` or below it.
const inside = (folder: string, path: string) => {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function userHome(): string | undefined {
  try {
    return resolve(homedir());
  } catch {
    return undefined;
  }
}

// What deleting the person's Otea data would remove: the Otea home (every project registered
// there, its boards and its history) and the .otea folder of a local project in the repo at cwd.
// Only for --purge-data. Refuses a home that is the user's own home folder, a filesystem root, or
// holds the folder the command runs in.
export function dataTargets(home: string, cwd: string, repoScope: boolean): string[] {
  const targets: string[] = [];
  const folder = resolve(home);
  if (existsSync(folder) && looksLikeHome(folder)) {
    if (folder === parse(folder).root || folder === userHome() || inside(folder, resolve(cwd))) {
      throw new CommandFailure(
        'forbidden',
        `${folder} is the Otea home but also a folder that holds more than Otea's data (a root, your home folder, or where you are): nothing was deleted; point OTEA_HOME at a folder of its own`,
      );
    }
    targets.push(folder);
  }
  if (repoScope) {
    for (const root of checkouts(cwd)) {
      const local = oteaDir(root);
      if (existsSync(local)) targets.push(local);
    }
  }
  return targets;
}

export function purgeData(targets: readonly string[], dryRun: boolean): Step[] {
  if (targets.length === 0) {
    return [{ what: 'data', changed: false, text: 'No Otea data to delete' }];
  }
  return targets.map((path) => {
    if (!dryRun) rmSync(path, { recursive: true, force: true, maxRetries: 5 });
    return {
      what: 'data' as const,
      path,
      changed: true,
      text: `${said(dryRun, 'Deleted', 'Would delete')} the Otea data in ${path}`,
    };
  });
}
