# Review instructions for Otea

Otea is a local-first Node 22 TypeScript CLI (`src/`) that serves a desk (`ui/`) and a phone PWA over LAN or Tailscale, an MCP server (`src/mcp/`) and an Electron app (`desktop/`). It writes hooks and an `AGENTS.md` block into users' repos. AGPL-3.0 plus a commercial license. You review pull requests from outside contributors; the maintainer reads only your comments and decides. Path-specific rules live in `.github/instructions/`.

## Shape of a comment

- One comment per real issue: file and line, why it hurts an Otea user or the project, a concrete fix. No diff summary, no praise.
- Label each `HIGH` or `ASK`. If nothing is high risk, say so in one line.
- Flag only what you can tie to a line of the diff.

## Never comment on (machines enforce it)

Formatting, style, naming, import order (Biome); types (`tsc`); commit messages (the `commits` check); `CHANGELOG.md` and version bumps (release-please); lockfile churn alone; generated files (`ui/dist`, `dist/`, `docs/images/*.gif`).

## HIGH: always flag

- **Secrets:** `ui-token`, device tokens, pairing codes, `push-keys.json` or push endpoints printed, logged, put in a URL or sent anywhere. Any new host contacted, telemetry, or analytics. Today Otea calls only: the loopback server, the browser's own push service (Web Push), the `tailscale` and `gh` CLIs, and GitHub Releases of `otea-dev/otea` (the desktop updater).
- **Filesystem:** writes outside `$OTEA_HOME`, the project and the documented spots (the `AGENTS.md` block, the git `pre-push` hook, `.otea/`). Editing a file Otea did not create without a marker, idempotency and a way to remove it (`src/cli/hooks.ts`, `src/app/agents.ts`). Path traversal from item ids, file names or attachments; following symlinks out of the project.
- **Processes:** `exec`, `shell: true` or a string-built command. Use `execFile` or `spawn` with an argument array and no shell, also when arguments come from item fields, branch names or file names. Check Windows (`cmd /c`, `.cmd` shims, quoting) and the lines of the generated `sh` hook.
- **Tests:** one that reads the real home, `~/.otea` or port 4400 (`src/test-setup.ts` forces a temp `OTEA_HOME`; keep it so), uses the network, or is weakened, skipped or deleted to go green.
- **Cross-platform:** hard-coded `/` or `\`, `path.join` on URLs, case-sensitive path compares, CRLF assumptions. CI runs Linux, Windows and macOS.
- **UI copy:** a user-facing string in `ui/src/` that is hard-coded, or exists in only one of `ui/src/i18n/en/` and `ui/src/i18n/es/`.
- **Network, Electron, data, contracts, dependencies, workflows:** see the path files in `.github/instructions/`.

## ASK: raise, do not block

- A behaviour change with no test that fails without it.
- `README.md`, `README.es.md` or `docs/` now disagree with the code (`docs/phone.md` for pairing, `docs/mcp.md` for tools).
- UX copy tone: Otea's copy is plain, short and calm, in both languages.
- Unrelated changes bundled in one pull request.
