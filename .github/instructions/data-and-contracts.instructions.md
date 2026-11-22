---
applyTo: "src/store/**,src/core/board/**,src/core/preset*.ts,src/app/board*.ts,src/app/migrate*.ts,schemas/**,presets/**,src/cli/**,src/mcp/**,src/core/agent-guide.ts,src/core/agent-prompts.ts,src/app/agent-prompts.ts"
---

# Stored data and the contracts agents depend on (HIGH)

## Data

- **Migrations** (`src/store/migrations.ts`): `MIGRATIONS` is an append-only array; `PRAGMA user_version` is the index. Flag editing, reordering or deleting an existing entry, a migration that drops a table or column holding user data (items, notes, evidence, boards, devices) or rewrites it lossily, or an entry without a transaction-safe SQL body. A new entry needs a case in `src/store/migrations.test.ts` that migrates real old rows, and the tests that assert the current version updated. Never "reset on mismatch".
- **Board and preset schema** (`src/core/board/schema.ts`, `src/core/preset.ts`, `presets/`): a changed board definition shape must keep old boards loading (`parseDefinition`, `readDefinition`, `src/app/board-migration.ts`) and update `schemas/board.schema.json` (regenerated with `OTEA_WRITE_BOARD_SCHEMA=1 npx vitest run src/core/board/json-schema.test.ts`, never by hand). Flag a schema change with no migration path for boards already published, or a hand-edited generated schema.
- **Board history and archives** (`board-archive`, `board_versions`): published board versions must stay readable.

## Contracts

- **CLI** (`src/cli/commands.ts`, `src/cli/exit-codes.ts`): flag names, output text and `--json` shape, and exit codes are used by agents and scripts. A removed or renamed flag, a changed exit code, a new failure with no `EXIT_CODES` entry, or a changed `{"error":{"code","message"}}` shape is HIGH unless the pull request says it is intended and updates `docs/`.
- **MCP** (`src/mcp/`): tool names are the CLI command with underscores (`send-back` is `send_back`), take the command's options by name, return the CLI's text as one text content, and stay in step with the CLI. Flag a tool renamed, removed or reshaped, `structuredContent`, or anything written to stdout besides the protocol. Writes stay pinned to `--project` (`forbidden`, exit 7).
- **Agent guide and prompts** (`src/core/agent-guide.ts`, `agent-prompts.ts`): every agent reads the guide each session, so each word costs tokens, and its rules are numbered and cross-referenced. Flag a rule added or reworded casually, or a growth in the output of `show`, `list`, `board`, `next` and `handoff`: `src/cli/token-budget.test.ts` holds budgets, and raising one needs a reason in the pull request.
- **Process spawning** (`src/cli/gitrepo.ts`, `gh.ts`, `forge.ts`, `owner.ts`, `src/server/drift.ts`, `diff-tip.ts`): `execFile` with an array, no shell; branch names, file names and item fields are untrusted. `git` and `gh` calls keep their timeouts. Writes to `.git/hooks` go through `hooks.ts` (marker, version line, `otea hook remove`).
- **Authority** (`src/core/authority.ts`, `lease.ts`): rules that stop an agent approving its own work, relaying its own step, or pushing to a protected branch must not weaken.
