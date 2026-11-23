# Security and data

What Otea keeps on your computer, what it listens on, what it sends out, what it writes into your repositories and how to remove it. Everything here is read from the code; if you find a line that no longer matches what Otea does, that is a bug worth reporting (see [SECURITY.md](../SECURITY.md)).

## In short

- Otea runs on your computer. The CLI and the MCP server read and write local files and talk to no server. `otea serve` and the desktop app run a small web server for the desk.
- That server listens on `127.0.0.1` only, unless you open the local network for a phone. Even on `127.0.0.1` it answers only a browser that signed in with the key in `ui-token`, or a paired device.
- Otea has no account, no cloud service and no telemetry. The few things that leave the computer are listed in [What leaves the machine](#what-leaves-the-machine).
- Otea writes into a repository only when you ask it to: [What Otea writes in your repositories](#what-otea-writes-in-your-repositories).
- Otea's rules (who reviews, what only you approve on the desk, what lands on main) hold against an agent's mistakes and overreach through `otea` and its MCP server. They do not stop an agent that sets out to act as you: one that runs as your user account with a shell can read the Otea home, sign a browser in with a sign-in link Otea prints under `--no-open`, or edit the database directly. Keep those links to yourself. If you need a hard boundary, run the agent in a sandbox or under another account without access to the Otea home.

## Where data lives

Everything is under the Otea home: `$OTEA_HOME`, which defaults to `~/.otea` (on every OS, so `C:\Users\<you>\.otea` on Windows).

| What | Where | Notes |
| --- | --- | --- |
| Each project's items, notes, events, boards and agents | `<home>/data/<project id>/otea.db` (SQLite) | One database per project. A project made with `otea init --local` keeps it in `.otea/otea.db` at the repository root instead. |
| Evidence files (screenshots, logs, anything attached to an item) | `<home>/data/<project id>/evidence/<sha256>` | Stored once by content hash. A copy under the attached name is linked at `files/<number>/<name>` beside it, for agents to open. Each file is capped at 50 MB. |
| Which folders belong to which project | `<home>/registry.db` | |
| Paired devices, phone settings, notification targets, the local projects the server serves | `<home>/machine.db` | A device's token is stored only as a hash. |
| The sign-in key | `<home>/ui-token` | 32 random bytes, base64url. Created on the first `otea serve` and reused. |
| The server's Web Push keys | `<home>/push-keys.json` | Used to send notifications to paired phones. |
| Where the server runs | `<home>/serve.json` | The port and the process id, nothing secret. |
| The port it last ran on | `<home>/serve-port` | Written by the background server (`otea serve start`, not for `--port 0`), kept after it stops, so the next start comes back on it. Nothing secret. |
| Single-use sign-in links | `<home>/signin-links/` | What `serve --no-open`, `serve start --no-open`, `start --no-open` and `open --no-open` print instead of the key: one file per link, named by the hash of its token, holding when it ends (10 minutes). Removed when used; the ones that ended go when the next link is made. A transcript that keeps a printed link holds nothing that signs in after one use or after 10 minutes. Redeeming a link sets the browser's session cookie, which carries the key itself (the same cookie `otea open` sets), so the link limits what a transcript leaks, not what a signed-in browser holds. |
| What the background server prints | `<home>/serve.log` | Written by `otea serve start`. It holds no sign-in link, and is emptied at the next start once it passes 256 KB. |
| The desktop app's preferences and recent projects | Electron's user data folder for `Otea` | `settings.json`, `recent-projects.json` and cached icons. |

Otea restricts `ui-token`, `push-keys.json` and `serve.log` to your user (mode `0600`; on Windows, which ignores the mode, an ACL for your account alone). It does not change the permissions of the databases or the evidence files: they have the permissions of the folder they are in, which for a home folder is normally your user's alone. The databases are not encrypted. If your disk needs to be protected at rest, use your operating system's disk encryption.

Otea moves nothing of this off the computer by itself. Backing up the Otea home (or a project's `data/<id>/`) is a plain copy of those files.

## What listens, and where

| What | Listens on | When |
| --- | --- | --- |
| `otea serve`, `otea serve start`, the desktop app | `127.0.0.1`, port 4400 (`--port` changes it) | While it runs. One server runs per Otea home. |
| The same server, on your private network addresses | each private address of this computer (`10.x`, `172.16-31.x`, `192.168.x`, Tailscale's `100.64-127.x`, link-local), at the same port | Only after you open the local network: Settings > Phone, `otea phone lan --open` or `otea serve --lan`. `otea serve start` never opens it. Closing it stops those listeners. |
| `otea mcp` | nothing: it speaks to the agent over standard input and output | While the agent runs it. |
| The CLI | nothing | |

The local network is plain HTTP and is closed by default. A phone gets in only after pairing: you read a code on the desk (valid for 10 minutes, burned by 5 wrong tries, 10 attempts a minute per address) and the phone sends it back; the server answers with a device token the phone keeps in a cookie. `otea devices revoke` or Settings > Phone ends a pairing at once. Over the local network a request must also name one of this computer's own private addresses or its `.local` name; any other name is refused. Through Tailscale, Otea runs `tailscale serve` (HTTPS on your tailnet, forwarding to `127.0.0.1`) only after you confirm the exact command shown in Settings > Phone.

### Reading from this computer needs the key too

Reaching `127.0.0.1:4400` is not enough to read the desk. The server answers its API (items, notes, evidence, events, live streams, settings) only to:

- a browser signed in with `otea open` (or `otea serve`, or the desktop app), which holds the session cookie `otea_session_<port>` (HttpOnly, `SameSite=Strict`); or
- a paired device, which holds its own cookie.

Anything else gets `401 unauthorized`. That includes other programs on this computer, other users of a shared machine, and web pages that point a browser at `localhost`. Two calls stay open without a session: `GET .../api/session`, which only says the caller cannot act, and the pairing calls, which have their own code check. The static page itself (its scripts and styles) carries no project data and is served to anyone who can reach the port, and `/` redirects to the first project's page, so its id (a name and six random characters) is visible. The sign-in at `/auth` is open too, but takes only the key.

The key is the file `<home>/ui-token`. `otea open` puts it in a one-time link to your own browser (sent with `Referrer-Policy: no-referrer`) and the server answers with the session cookie; `otea phone` and the desktop app read the file and send the same cookie. Anything that can read your home folder as you can read the key, and could read the databases directly too: the key protects against other users and against pages in your browser, not against code running as you. To get a new key, stop the server, delete `ui-token` and start it again; every browser then signs in again with `otea open`.

Writes need more still: the signed-in browser, the page's own origin (checked on every write), and, for what changes a project's setup, the desk's own browser rather than a paired phone.

### DNS rebinding

A page on the internet can try to make your browser talk to `localhost` under its own name. Otea refuses a request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (or, over the local network, one of this computer's own private addresses or `.local` name), and refuses any request a proxy forwarded (`X-Forwarded-For`) unless it came through the Tailscale door you set up. The session cookie is `SameSite=Strict`, so a page on another site never sends it either. Cookies are scoped by host, not port, though: another web server on `127.0.0.1` or `localhost` that your browser visits receives the cookie too, so only run local servers you trust in the browser you sign in with.

## What leaves the machine

Nothing leaves the computer on its own, with these exceptions, each tied to something you did:

- **Git and GitHub, in your repositories.** When a board protects a branch, `otea check` and the desk ask the repository's own remote what it holds (`git ls-remote`, and `git fetch` of that branch) to compare it with what was approved. That is the remote you already configured, using your git credentials. `otea hook install --forge` runs the `gh` CLI, signed in as you, to set a GitHub ruleset on the protected branches. Otea sends nothing to any other server.
- **Notifications to a paired phone.** If you subscribe a phone to notifications (this needs Tailscale's HTTPS), the server posts an encrypted Web Push message to the push service your phone's browser named (its address is in the subscription). The push service sees the message's size and timing, not its text.
- **The desktop app's updates.** An installed desktop app (not `otea` from npm) checks the project's GitHub Releases for a newer version when it starts and every four hours, and downloads it in the background when there is one (an unsigned macOS build only tells you a newer one exists).
- **Phone status checks.** `otea phone status` and Settings > Phone fetch `/manifest.webmanifest` from the phone URLs (this computer's `.local` name and private addresses, or your Tailscale host name) to tell whether Otea answers there. They are requests to your own computer or your own tailnet name, nothing else.
- **Tailscale.** If you choose it, your phone reaches the desk through Tailscale's network, as that service works. Otea only runs the `tailscale` command on your computer.

- **The `otea` command's version check.** At most once a day, when you run `otea` at a terminal, it sends one `GET` to the npm registry (`https://registry.npmjs.org/@otea%2Fcli/latest`, no cookie, no identifier, no body) and prints one line if a newer `@otea/cli` exists. The registry sees your IP address and that request, as for any `npm` call. The answer is kept in `update-check.json` in the Otea home, and a failed or slow try (it waits at most about a second) is tried again in an hour. It never runs in CI (`CI` set), under `--json`, when the output is piped, for an agent (`--as`, or `OTEA_AGENT` set), for `otea mcp`, `check`, `serve`, `wait`, `events` or `uninstall`, or in the desktop app. `OTEA_NO_UPDATE_CHECK=1` turns it off.

Apart from the list above, Otea sends no usage data and makes no other network request. If that changes, this page changes with it.

The web page the server serves loads its fonts and scripts from the server itself, not from a CDN.

## What Otea writes in your repositories

Common storage (the default for `otea init`) writes nothing into the repository. Otea writes there only when a command asks it to:

| File | Written by | Notes |
| --- | --- | --- |
| `AGENTS.md` | `otea init --agents-md`, `otea connect` | A short block between `<!-- otea:begin -->` and `<!-- otea:end -->` that tells agents to read `otea board` and run `otea next`. Yours to commit. |
| `.git/hooks/pre-push` (or where `core.hooksPath` points) | `otea hook install --git` | Runs `otea check` before a push and refuses a push a board protects. Never overwrites another pre-push hook. Never committed when under `.git`. |
| a GitHub ruleset on the repository | `otea hook install --forge` | Set through `gh`, only when you run it. |
| `.otea/` and a line `.otea/` in `.git/info/exclude` | `otea init --local` | The project's data, kept out of git. |

Otea writes no agent configuration: no `.mcp.json`, no `.claude/` files. `otea connect` prints the MCP server entry, and each agent adds it to its own harness. Older versions could write Claude Code hooks to `.claude/settings.local.json`; Otea no longer does, and `otea hook remove --claude` takes out what they wrote.

More on these files in [Projects](projects.md#files-otea-writes-in-the-repo).

## Removing Otea

The short way: `otea uninstall --dry-run` lists what it would do, and `otea uninstall` does it in every repository the registry knows (the pre-push hook and the `AGENTS.md` block, only when they are exactly what Otea wrote) and stops the server; `--purge-data` also deletes the Otea home after you confirm. The steps by hand:

1. Stop the server: `otea serve stop` (and quit the desktop app).
2. In each repository you used it in, take out what it wrote: `otea hook remove --git`, `otea hook remove --forge` and, if an older version wrote them, `otea hook remove --claude`; delete the block between `<!-- otea:begin -->` and `<!-- otea:end -->` in `AGENTS.md`; delete `.otea/` and any `.otea.migrated-*` folder of a local project, and the `.otea/` line in `.git/info/exclude`.
3. Remove Otea's MCP server from each agent's configuration (the entry named `otea`).
4. If you set up Tailscale for a phone: `tailscale serve --https=443 off`.
5. Uninstall the program: `npm uninstall -g @otea/cli`, or uninstall the desktop app with your system's usual way (the Windows installer takes its `PATH` entry with it; on macOS delete `/usr/local/bin/otea` if you added it).
6. Delete the Otea home, `~/.otea` or whatever `$OTEA_HOME` names. This is every project's data, the evidence files and the keys, and it cannot be undone. Export or copy what you want to keep first.
7. Delete the desktop app's user data folder (`Otea` in your system's application data folder), if you used it.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
