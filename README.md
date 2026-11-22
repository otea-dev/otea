<h1 align="center">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/images/otea-logo-dark.svg">
<img src="docs/images/otea-logo-light.svg" alt="Otea" width="116" height="161">
</picture><ruby><rp>Otea</rp></ruby>
<br>
<a href="https://www.npmjs.com/package/@otea/cli"><img src="https://img.shields.io/npm/v/@otea/cli?label=npm&color=2d54d3" alt="npm version"></a>
<a href="https://github.com/otea-dev/otea/releases/latest"><img src="https://img.shields.io/github/v/release/otea-dev/otea?label=download&color=2d54d3" alt="Latest release"></a>
<a href="https://github.com/otea-dev/otea/actions/workflows/ci.yml"><img src="https://github.com/otea-dev/otea/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.18-339933" alt="Node &gt;=22.18"></a>
</h1>

**A local board where your AI agents hand you their work, and you hand back decisions, without keeping their sessions open.**

¿Hablas español? Lee el [inicio rápido en español](README.es.md).

> From the Spanish verb *otear*: to scan from a high vantage point, to watch what is happening and what is coming.

Agents produce work faster than a human can follow it live. Otea is where work changes hands: agents leave findings, deliverables and evidence; you leave decisions and feedback; both can see at any moment where each thing stands and whose turn it is.

**The handoff lives in the item, not in the session.** Evidence, history and the next step are stored with the item, so an agent can hand it over and its session can close instead of sitting open waiting for you. Any later session picks it up from `otea show`, whose `Next:` line says what to do now, and `otea wait` blocks until an item is the agent's turn again. A lease the closed session held expires on its own.

- **Triage** many findings at once: filter, group, prioritize, discard.
- **Review** results in depth: GIFs, video, diffs, logs, with concrete questions the agent reads back and acts on.
- **Boards** shape the work: their steps, who does and reviews each, what a handoff carries. **Templates** start a board, or several joined boards at once (a Cambio that divides into one Tarea de repo per repository).
- **Local-first**: data stays with your project. No cloud, no accounts.
- **Harness-neutral**: any agent with a shell (CLI) or MCP support can use it.
- **Traceable**: every change is an append-only event, with who made it and through which channel.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/demo-agent-loop-dark.gif">
  <img src="docs/images/demo-agent-loop-light.gif" alt="A change's page on the desk: the agent ticks the checklist (branch, diff, screenshots), the route moves from its lane to yours, and the person presses Approve. Caption: The agent does the steps. You only review.">
</picture>

**The agent does the steps; you only review.** It ticks the checklist the board asks for, the route moves from its lane to yours, and all that is left for you is Approve.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/desk-your-turn-dark.png">
  <img src="docs/images/desk-your-turn-light.png" alt="The desk's Your turn page in a demo project: an agent's question, a change to review, a bug to triage and a change an agent is working on">
</picture>

**Your turn**, the desk's first page: what waits for you, and what the agents are on.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/desk-review-dark.png">
  <img src="docs/images/desk-review-light.png" alt="A change under review on the desk: the agent's diff and its before and after screenshots, side by side">
</picture>

A change under review, with the evidence its step asked for: the diff and before-and-after screenshots.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/phone-review-dark.png">
  <img src="docs/images/phone-review-light.png" alt="The same change on a phone: the agent's handoff note, with Send back and Approve" width="300">
</picture>

The same change on a phone, with the agent's note and your two moves.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/demo-phone-answer-dark.gif">
  <img src="docs/images/demo-phone-answer-light.gif" alt="A phone shows a question from an agent; the person taps Answer, types a reply and sends it, and the small desk beside it shows the question gone. Caption: Answer your agents from your phone.">
</picture>

**Answer your agents from your phone.** A question from an agent reaches your phone; you answer there, and the desk shows the agent going on.

## Status

Early: usable, still changing fast. The product definition lives in [`docs/otea-product-definition.md`](docs/otea-product-definition.md).

## Install

> [!NOTE]
> The first release is not out yet: until it is, there is nothing to download and `@otea/cli` on npm is only a placeholder, so [install from source](#from-source). From the first release, the steps below work as written.

There are two ways to install Otea: the **desktop app**, or the **`otea` command from npm**. Both are the same Otea, with the same boards, phone and agents.

**Which one?**

- **Windows:** the desktop app. One click installs it, it updates itself and it puts `otea` in your terminal.
- **macOS:** the desktop app, if you want Otea in its own window with notifications. It cannot update itself yet: you download each new version. If you already use Node, npm is just as good.
- **Linux:** the desktop app as a `.deb` on Debian or Ubuntu. On other distributions, the AppImage, or npm if you want `otea` in your terminal.

### What each one gives you

| | Desktop app | npm (`npm i -g @otea/cli`) |
| --- | --- | --- |
| How you open Otea | Its own window, from the app icon | A tab in your browser, after `otea serve` in a terminal |
| Icon in the tray or menu bar | ✅ Shows what waits for you; closing the window keeps it running | ❌ |
| Count on the taskbar or Dock | ✅ Windows and macOS · ❌ Linux | ❌ |
| Notifications on this computer | ✅ The system's own | ❌ |
| Updates | ✅ Windows · ✅ Linux (the `.deb` asks for your password) · macOS: it tells you, you download it | By hand: `npm i -g @otea/cli` again |
| `otea` in your terminal | ✅ Windows and `.deb` · macOS: one click in the menu bar · ❌ AppImage | ✅ |
| Needs Node.js | ❌ It brings its own | ✅ Node.js 22.18 or later |

Everything else works the same both ways: boards, the phone (pairing and notifications on it), agents over the CLI or MCP. Neither starts on its own when you log in.

### The desktop app

Download the installer for your system from the [latest release](https://github.com/otea-dev/otea/releases/latest):

| System | File |
| --- | --- |
| Windows | `Otea-Setup-<version>.exe` |
| macOS (Apple silicon and Intel) | `Otea-<version>-mac.dmg` |
| Linux, Debian or Ubuntu | `Otea-<version>-amd64.deb` |
| Linux, any other | `Otea-<version>-x86_64.AppImage` |

The installers are not signed yet: Otea is an open-source project without a paid signing certificate so far. Your system warns you the first time; here is how to get past it.

**Windows.** Open the `.exe`. If a blue window says "Windows protected your PC", click **More info**, then **Run anyway**. Otea installs for you alone (no administrator needed) and opens.

**macOS.** Open the `.dmg` and drag Otea to Applications. Open Otea: macOS says it cannot check it. Click **Done** (or **OK**), then open **System Settings › Privacy & Security**, scroll down to the message about Otea and click **Open Anyway**. Confirm, and Otea opens; from then on it opens normally. To have `otea` in your terminal, click the Otea icon in the menu bar and choose **Install the otea command**. Updates are manual for now: when a new version is out, Otea tells you, and you download it and drag it to Applications again.

**Linux, `.deb`.** In a terminal, in the folder with the file:

```sh
sudo apt install ./Otea-*.deb
```

This puts Otea in your apps menu and `otea` in your terminal.

**Linux, AppImage.** In a terminal, in the folder with the file:

```sh
chmod +x Otea-*.AppImage
./Otea-*.AppImage
```

### Check your download

Each release has a `SHA256SUMS.txt` with a fingerprint of every installer. If your file's fingerprint matches its line, it is the file the release published. Download `SHA256SUMS.txt` to the same folder, then:

- **Windows** (PowerShell): `Get-FileHash .\Otea-Setup-*.exe` prints the fingerprint. Find the same text in `SHA256SUMS.txt` (case does not matter).
- **macOS** (Terminal): `shasum -a 256 Otea-*-mac.dmg` prints the fingerprint. Find the same text in `SHA256SUMS.txt`.
- **Linux**: `sha256sum -c --ignore-missing SHA256SUMS.txt` checks the files you have and says `OK` for each.

### The `otea` command from npm

You need [Node.js](https://nodejs.org/) 22.18 or later (Node 24 recommended). Check with `node --version`. Then:

```sh
npm i -g @otea/cli
otea --version
```

To update, run `npm i -g @otea/cli` again. To remove it, `npm uninstall -g @otea/cli`. You open the desk with `otea serve` (see [Get started](#from-the-terminal-npm-or-source)).

### From source

To work on Otea, or to run what is not released yet (until the first release, this is the only way). It takes Git and Node.js 22.18 or later (Node 24 recommended):

```sh
git clone https://github.com/otea-dev/otea.git
cd otea
npm ci              # the CLI's dependencies
npm run build:ui    # the web UI that otea serve shows
npm link            # puts the otea command on your PATH
otea --version
```

`npm link` installs a real command, not an alias: a symlink in npm's global `bin` on macOS and Linux, and `otea.cmd`, `otea.ps1` and a shell script in npm's global folder on Windows. Every shell finds it, so an agent's own shell (Claude Code's, OpenCode's, a script's) runs `otea` the same as your terminal. Run `npm prefix -g` to see where it went; if `otea` is not found, add that folder (on macOS and Linux, its `bin`) to your PATH. To update, `git pull`, `npm ci` and `npm run build:ui` again; `npm unlink -g @otea/cli` takes the command away. To build the desktop app from source, see [`desktop/README.md`](desktop/README.md).

### On Windows, in Git Bash

Git Bash turns an argument that starts with `/` into a path (`/deploy` reaches Otea as `C:/Program Files/Git/deploy`). Otea undoes it for the text it is given (a title, a field, a note), so `otea create --title "/deploy fails"` keeps its slash. Anywhere else, set `MSYS_NO_PATHCONV=1` for that command, or start the value with `//`.


## Get started

Which steps you follow depends on how you installed Otea. Both paths end at the same place: the desk, with the text to give your agent.

### With the desktop app

You do not run `otea init` or `otea serve`: the app does both for you.

1. **Open Otea and pick the project folder.** The first time, the app asks you to open a project:
   - **Open folder** picks a folder that is already an Otea project. If it is not one yet, the app asks "Create one there?" and makes it when you say yes.
   - **Create project** picks the folder for a new project.

   Choose the folder you want to track, usually a repository. If it is inside a git repository, the app offers to create the project for the whole repository. Nothing is written into the repo, and the project starts with no boards. The next times, Otea reopens your last project; **Switch project…** in the tray or menu bar icon brings the picker back.

2. **The desk opens in the app's window.** A project with no boards starts on **Your turn**, with a text for your agent and a **Copy the instruction** button. The **Connect an agent** button shows the same text later.

3. **Check that your agent can run `otea`.** The text has your agent run `otea` commands, so `otea` has to be in its terminal. Windows and the Linux `.deb` set that up when they install (open a new terminal, or restart your agent, after installing). On macOS, click the Otea icon in the menu bar and choose **Install the otea command**. The AppImage does not set it up: use the `.deb` or npm.

Then [give your agent the text](#give-your-agent-the-text).

### From the terminal (npm or source)

1. **Make the project.** In the folder you want to track, usually a repository:

   ```sh
   otea init
   ```

   It says where the project's data lives and what to do next:

   ```text
   Project data in ~/.otea/data/tienda-web-yafrhx
   Next: run otea serve in a terminal of your own, or open the Otea desktop app: the desk gives you the text to paste into your agent's chat (otea prompt prints it here).
   ```

   Nothing is written into the repo, and the project starts with no boards.

2. **Open the desk.** In a terminal of your own, and leave it running:

   ```sh
   otea serve
   ```

   It prints `Otea running at http://127.0.0.1:4400/p/tienda-web-yafrhx/` and opens the desk in your browser, signed in. A project with no boards opens on **Your turn** with a text for your agent and a **Copy the instruction** button.

### Give your agent the text

Both paths meet here. Paste the text into your agent's chat (Claude Code, OpenCode, Codex or any other with a shell or MCP); `otea prompt` prints the same text in a terminal. The agent connects itself, reads the project, asks you one question at a time how you work and drafts its boards. You try them and publish them in Studio. From then on each request goes through a board, and what waits for you shows in **Your turn**.

## Everyday commands

| You run | What it does |
| --- | --- |
| `otea init` | makes the project for this folder |
| `otea serve` | opens the desk in your browser |
| `otea prompt` | prints the text to paste into an agent's chat |
| `otea board add <name> --template <key>` | adds a board from a template, published at once |
| `otea topic on` | has agents keep the side questions you ask them, with their answers |
| `otea devices list` | lists the paired phones; `otea devices revoke <id>` unpairs one |
| `otea hook install --git` | in a repo: a pre-push hook that checks each push against the boards |

| Agents run | What it does |
| --- | --- |
| `otea next` | says which item to take now and what its step asks |
| `otea claim <id>` | holds the item for this step, so no other agent writes it |
| `otea handoff <id>` | hands the step on, refused until it carries what the step asks |
| `otea wait --turn agent --unclaimed` | blocks until there is work, then `otea next` again |

`otea help` lists every command, and `otea <command> --help` its options; the [docs](#docs) go into each part.

## Why Otea, and when not

An issue tracker or a TODO.md holds what to do. Otea also holds how, and checks it:

- **The board is the procedure.** An agent reads each step's instructions from the board (`otea next`), not from a prompt you repeat in every session.
- **Handoffs carry evidence.** The diff, the screenshots, the test output or the recording come with the item, and you review them there.
- **A gate checks what an agent can push.** The pre-push hook lets a branch through only while its item's step allows it, and a base branch the board protects only once you approved.

When not to use it:

- You pair live with one agent and never step away: the chat already is the handoff.
- You need cloud sync or accounts: Otea is local-first, and its data stays on your computer.
- You need a signed installer: Otea's installers are not signed yet.

## Help

Questions and bugs go to [GitHub Issues](https://github.com/otea-dev/otea/issues). Report a security problem privately, as [SECURITY.md](SECURITY.md) says.

## License

Otea is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, study, modify and share it. If you distribute a modified version, or let people use it over a network, you must publish its source under the same license, keeping the copyright notices.

**Commercial license.** If the AGPL does not fit your use (for example, embedding Otea in a closed product), a commercial license is available. Open an issue or contact Federico Daniel Ara ([@Lartweib](https://github.com/Lartweib)).

**Name.** "Otea" and its logo identify this project. Forks are welcome under the AGPL, but must use a different name.

Contributions are accepted under the [Contributor License Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Docs

- [Working with agents](docs/working-with-agents.md): the commands agents run, leases, relaying a decision, waiting and events, the guide, profiles and stats, what to paste into an agent's chat, and what your harness must allow.
- [MCP](docs/mcp.md): working from an MCP client, `otea connect` and the tools.
- [Projects](docs/projects.md): where a project lives, the files Otea writes in the repo, linking several repos, and moving a local project to common storage.
- [Evidence](docs/evidence.md): attaching files as proof, and how the item page draws them.
- [Relations](docs/relations.md): parents, blockers and the other links between items.
- [Boards](docs/boards.md): templates, the Matrix, boards that divide into others, an agent drafting a board, archiving, and the moves and git gates of agents.
- [Topics](docs/topics.md): the side questions agents keep as short conversations.
- [The desk](docs/desk.md): `otea serve`, the web UI, and its API for agents at work and notes.
- [Several projects and a phone](docs/phone.md): one server for every project, the phone on the local network or Tailscale, and notifications.
- [Development](docs/development.md): tests, `npm run dev:ui` and the token budget.
