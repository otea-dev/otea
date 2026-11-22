import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { removeAgentsMd } from '../app/agents.ts';
import { listProjects } from '../app/home.ts';
import { databasePath, gitCommonDir, oteaDir } from '../app/project.ts';
import { reposInside } from '../app/repos.ts';
import { contains, pathKey } from '../core/path-key.ts';
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
  // Something that went wrong and was reported; the rest of the work went on.
  failed?: true;
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
  let agents: ReturnType<typeof removeAgentsMd>;
  try {
    agents = removeAgentsMd(root, dryRun);
  } catch (error) {
    steps.push(failedStep('agents-md', join(root, 'AGENTS.md'), error));
    return steps;
  }
  if (agents.action === 'refused') {
    steps.push({
      what: 'agents-md',
      path: agents.path,
      changed: false,
      kept: true,
      text: `Left ${agents.path}: ${agents.reason}`,
    });
    return steps;
  }
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
    if (!(error instanceof CommandFailure)) {
      steps.push(failedStep('git-hook', undefined, error));
    } else {
      steps.push(leftHook(cwd, error));
    }
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
    steps.push(
      error instanceof CommandFailure
        ? {
            what: 'claude-hooks',
            changed: false,
            kept: true,
            text: `Left it: ${error.message}`,
          }
        : failedStep('claude-hooks', undefined, error),
    );
  }
  return steps;
}

// What went wrong with one thing, told without stopping the rest.
function failedStep(what: Step['what'], path: string | undefined, error: unknown): Step {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    what,
    ...(path === undefined ? {} : { path }),
    changed: false,
    failed: true,
    text: `Could not clean ${path ?? what}: ${reason}`,
  };
}

// A pre-push hook left as it is, and why.
function leftHook(cwd: string, error: CommandFailure): Step {
  const path = foreignGitHookRunsOtea(cwd);
  return {
    what: 'git-hook',
    changed: false,
    kept: true,
    text:
      path === undefined
        ? `Left the pre-push hook: ${error.message}`
        : `Left ${path}: it is another pre-push hook, with Otea's check in it; take those lines out yourself`,
  };
}

// The folders `otea uninstall` goes through: the repo at cwd with all its worktrees (each has its
// own AGENTS.md), then every folder the registry links to a project, a repo or a folder over
// several repos (and the repos and worktrees below it): the projects Otea was set up in. Each once.
// A registered folder that is gone is skipped, and said.
export function repoTargets(cwd: string, home: string): { targets: string[]; missing: string[] } {
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
  for (const { paths } of readRegistry(home)) {
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

const REGISTRY_FILE = 'registry.db';

// The projects the registry in `home` links to folders, read without writing anything: not
// created when missing, not migrated, not switched to WAL. Nothing when it cannot be read. A
// registry no server holds open is read as the file it is (immutable), so no -wal or -shm file
// appears beside it; one a server has open is read through its WAL, whose files already exist.
function readRegistry(home: string): ReturnType<typeof listProjects> {
  const file = join(home, REGISTRY_FILE);
  if (!existsSync(file)) return [];
  const live = existsSync(`${file}-wal`);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(live ? file : `${pathToFileURL(file).href}?immutable=1`, {
      readOnly: true,
    });
    return listProjects(db);
  } catch {
    return [];
  } finally {
    db?.close();
  }
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
  home: string,
  dryRun: boolean,
): { reports: RepoReport[]; missing: string[] } {
  const { targets, missing } = repoTargets(cwd, home);
  const told = new Set<string>();
  const reports = targets.map((path) => {
    let done: Step[];
    try {
      done = uninstallFolder(path, dryRun);
    } catch (error) {
      // One folder's trouble (a file in use, an unreadable one) never stops the others.
      const reason = error instanceof Error ? error.message : String(error);
      return {
        path,
        steps: [
          {
            what: 'agents-md' as const,
            path,
            changed: false,
            failed: true as const,
            text: `Could not clean ${path}: ${reason}`,
          },
        ],
      };
    }
    const steps = done.filter((step) => {
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
export async function uninstallServer(home: string, main: string, dryRun: boolean): Promise<Step> {
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

function userHome(): string | undefined {
  try {
    return realpathSync.native(homedir());
  } catch {
    return undefined;
  }
}

// The real path of a folder, or its resolved one when it does not exist.
const real = (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

// Why `folder`, an Otea home about to be deleted, must not be: it is a filesystem root, the
// person's own home folder, or holds the folder the command runs in or their home folder. Real
// paths, compared in the form the file system compares them (case-insensitively where it is), and
// by containment, never by how the text starts. Nothing when it is safe to delete.
export function unsafeHome(
  folder: string,
  cwd: string,
  own: string | undefined = userHome(),
): string | undefined {
  const at = real(folder);
  const key = (path: string) => pathKey(path, process.platform);
  const here = key(at);
  if (here === key(parse(at).root)) return 'a filesystem root';
  if (own !== undefined && contains(here, key(own))) return 'or holds your home folder';
  if (contains(here, key(real(cwd)))) return 'or holds the folder you are in';
  return undefined;
}

// What deleting the person's Otea data would remove: the Otea home (every project registered
// there, its boards and its history) when it holds a registry, and the .otea folder of a local
// project in the repo at cwd. Only for --purge-data. `home` is resolved against `cwd`. Refuses a
// folder that is more than Otea's home (unsafeHome), and deletes nothing then.
export function dataTargets(home: string, cwd: string, repoScope: boolean, own?: string): string[] {
  const targets: string[] = [];
  const folder = resolve(cwd, home);
  if (existsSync(join(folder, REGISTRY_FILE))) {
    const why = unsafeHome(folder, cwd, own);
    if (why !== undefined) {
      throw new CommandFailure(
        'forbidden',
        `${folder} holds Otea's registry but is also ${why}: nothing was deleted; point OTEA_HOME at a folder of its own`,
      );
    }
    targets.push(real(folder));
  }
  if (repoScope) {
    for (const root of checkouts(cwd)) {
      const local = oteaDir(root);
      if (existsSync(databasePath(local))) targets.push(local);
    }
  }
  return targets;
}

// Deletes what dataTargets named; one that cannot be (in use: EBUSY, EPERM) is reported and the
// rest goes on.
export function purgeData(targets: readonly string[], dryRun: boolean): Step[] {
  if (targets.length === 0) {
    return [{ what: 'data', changed: false, text: 'No Otea data to delete' }];
  }
  return targets.map((path): Step => {
    try {
      if (!dryRun) rmSync(path, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        what: 'data',
        path,
        changed: false,
        failed: true,
        text: `Could not delete the Otea data in ${path}: ${reason} (is something still using it? close it, then run this again)`,
      };
    }
    return {
      what: 'data',
      path,
      changed: true,
      text: `${said(dryRun, 'Deleted', 'Would delete')} the Otea data in ${path}`,
    };
  });
}
