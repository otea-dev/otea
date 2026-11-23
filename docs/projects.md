# Projects

`otea init` creates the project for the repository root (or the folder itself outside git) in common storage: its data goes to `$OTEA_HOME/data/<id>/` (`OTEA_HOME` defaults to `~/.otea`), the user-level registry links the root to it, and `init` itself writes nothing into the repo. Three commands do, when asked: `otea init --agents-md` and `otea connect` add a marked block to `AGENTS.md`, and `otea hook install --git` writes the pre-push hook (see [Files Otea writes in the repo](#files-otea-writes-in-the-repo)); `otea uninstall` removes all of it. `otea init --local` keeps the data in `.otea/` at the root instead, excluded from git through `.git/info/exclude`. Every command finds the project from any subfolder or git worktree of that repo: the nearest registered folder containing the working directory or the main repo root, or else the nearest folder above the main repo root holding `.otea/otea.db`. So one project can also live in a product folder above several repos (the folder need not be a repo): run `otea init` there, and commands from inside any of those repos use it. `otea init` inside a repo that such a project already covers refuses; `otea init --here` creates a separate project at the repo, which then wins for it. `OTEA_PROJECT=<path>` skips discovery and names the project folder directly (or a registered folder, or a project id). The MCP server and `otea serve` find the project the same way (`otea serve` then opens that project's page on the computer's one server).

Each project has an identity stored in its database: a name (its folder's) and an id, the name as a slug plus six random base32 characters (`my-app-k3x7qa`). `otea init --json` prints both next to `root`, `path` (the data folder) and `storage`, and `GET /api/project` returns them. A database created before identities gets one the first time it is opened.

## Files Otea writes in the repo

Common storage keeps every item, board and event outside the repo. Inside it, Otea writes only when a command asks it to, and it keeps each file that names this machine out of git through `.git/info/exclude` (never `.gitignore`, which is tracked):

| File | Written by | In git |
| --- | --- | --- |
| `.otea/` | `otea init --local` | excluded: the project's data |
| the `pre-push` hook (`.git/hooks`, or where `core.hooksPath` points) | `otea hook install --git` | never committed under `.git/hooks` |
| `AGENTS.md` | `otea connect`, `otea init --agents-md` | yours to commit: it tells every agent to use Otea |

The `AGENTS.md` block is the text between `<!-- otea:begin -->` and `<!-- otea:end -->`. It points to `otea board` and holds no copy of the agent guide, so it does not go stale; the rest of the file is yours and is never touched. `otea connect` says each time it writes or updates the block, naming the file (with `--json`, `agentsMd` has its `path` and `action`: `created`, `added`, `updated` or `unchanged`).

`otea uninstall` takes all of it out, and only what carries Otea's mark: the hook (a pre-push hook that is not Otea's stays), the block, and the file when nothing else is in it. It goes through the repo you run it in and every repo or folder the registry links to a project (a linked folder that no longer exists is skipped and named), and `--dry-run` lists every repo and file it would touch first. It never deletes `.otea/` or the Otea home unless `--purge-data` says so and you confirm. See [Upgrade and remove](../README.md#upgrade-and-remove).

Otea writes no harness config (no `.mcp.json`, `opencode.json` or other): each agent adds Otea's MCP server to its own harness, as `otea connect` tells it (see [Working from an MCP client](mcp.md#working-from-an-mcp-client)).

## Linking several repos to one project

A product split across separate repos (not nested in one folder) can share one project, since common storage keeps it in the Otea home (`OTEA_HOME`, default `~/.otea`) instead of in any repo:

```sh
cd ~/code/api && otea init               # creates the project, prints its data folder
otea projects current                    # api-k3x7qa  api  common, then the root and the data folder
cd ~/code/web && otea init --join api-k3x7qa   # or the project's name, when it is unique
otea projects add ~/notes/api --to api-k3x7qa  # any other folder
otea projects list                       # every registered project with its linked folders
otea projects relink ~/code/web ~/src/web     # the repo moved
otea projects forget ~/notes/api         # unlink a folder; the project and its items stay
otea repos list                          # the repos its items name: api  remote:github.com/acme/api
otea repos add ~/code/web --name web     # add a repo (or rename one); every clone of it is web
```

A remote added to a repo after `otea init` changes what the repo is known by (its origin, no longer its first commit). Otea does not assume it is the same repo, since every fork shares that commit: until the person says so, every push from it is refused. `otea next` and `otea claim` tell the agent in that checkout, which asks the person; the person's word is `otea repos add --name <repo>`, run once in the checkout.

Commands, the MCP server and `otea serve` in any linked folder (and its subfolders and worktrees) then use that project: an item created from `api` is listed from `web`. Common storage writes no data into the repo, not even `.otea/` (only `otea init --agents-md`, `otea connect` and `otea hook install` write files there, when asked, and `otea uninstall` removes them). The user-level registry (`$OTEA_HOME/registry.db`) records which folders lead to which project: a folder belongs to one project only, a folder with its own `.otea/` project cannot be linked, and when both a linked folder and a local project contain the working directory, the nearer one wins. A local project (`otea init --local`) cannot be shared this way.

When a repo moves, `otea projects relink <old> <new>` points its link at the new folder, but only when the new folder is the same repo: the same origin URL (a trailing `.git` or `/` aside) or the same root commit, compared with the old folder if it still exists and else with what was recorded when it was linked. Another repo is refused (exit code 17, `different_repo`) unless `--force`; when neither can be checked (plain folders, a repo with no remote and no commit) it relinks with a warning. `otea projects forget <path>` removes a link and never the data: a project left with no linked folder stays registered with its items, nothing resolves to it, and `otea init --join` or `otea projects add` links a folder to it again. A project knows its repos by their origin URL (its https, ssh and `git@host:path` forms are one; without an origin, by the root commit), under the name a repo task's `repo` field holds: the repos at its folders are added under their folder names when it is created or a folder is linked, so a clone or worktree in any other folder still goes by the repo's name, and a gate check (`--repo` with no name) in a repo the project does not know refuses until `otea repos add` names it. A command run where no project resolves says so (exit code 3); when projects are registered, it also suggests `otea init --join <id>` and `otea projects list`. `otea projects list` marks linked folders that no longer exist with `(missing)`.

## Moving a local project to common storage

A project created in `.otea/` (with `otea init --local`, or before common storage was the default) stays there until you move it; Otea never migrates on its own. `otea migrate --to common`, run from the project:

1. copies the database into `$OTEA_HOME/data/<id>/` with `VACUUM INTO` and checks the copy (`PRAGMA integrity_check`, and the same row count and last row id in every table);
2. copies `evidence/` and `presets/`, registers the project (same id) and links its folder;
3. renames `.otea/` to `.otea.migrated-<date>-<time>/`, a backup Otea never deletes (excluded from git like `.otea/`);
4. prints what it did and how to undo it: `otea projects forget <folder>`, rename the backup back to `.otea`, and delete the copied data folder once it is no longer needed.

It refuses (exit code 18, `in_use`) while this computer's `otea serve` runs (it holds the project's database open), and when another process holds or writes the database during the move, leaving everything as it was. Running it again on a migrated project does nothing; if a run stopped after registering the project, the next one only moves the old folder aside, once its contents match the copy.
