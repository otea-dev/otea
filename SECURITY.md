# Security

Please report a security problem privately, never in a public issue, discussion or pull request.

Report it through GitHub's private vulnerability reporting: on [this repository](https://github.com/otea-dev/otea), open the **Security** tab and choose **Report a vulnerability**. Only you and the repository's maintainers see the report until a fix is out.

Say what you found, how to reproduce it and what it lets someone do. Otea has had no release yet, so name the commit you built from (`git rev-parse --short HEAD` in your checkout): fixes land on `main`.

This covers the CLI, the MCP server, `otea serve` (its sign-in, phone pairing and transports) and the desktop app.

## What Otea touches and exposes

The full account is in [Security and data](docs/security.md). In short:

- **Data stays on your computer.** Projects, items, notes and evidence files live in the Otea home (`~/.otea`, or `$OTEA_HOME`), or in `.otea/` for a local project. Otea has no account, no cloud service and no telemetry.
- **The server listens on `127.0.0.1` by default** (port 4400). It listens on your private network addresses only after you open the local network for a phone, and a phone reaches it only after pairing with a code shown on the desk.
- **Reads need the key, even on this computer.** The API answers a browser signed in with the key in `ui-token` (set up by `otea open`, `otea serve` or the desktop app) and a paired device; any other request, from another program, another user of the machine or a web page, gets `401`. A request whose `Host` is not the server's own address is refused, against DNS rebinding.
- **What leaves the machine:** git operations against the remote you already configured when a board protects a branch, `gh` when you run `otea hook install --forge`, Web Push messages to a paired phone's push service, and the desktop app's update check against GitHub Releases. Nothing else.
- **What Otea writes in a repository, only when asked:** the block in `AGENTS.md`, a `pre-push` hook, a GitHub ruleset and, for a local project, `.otea/`. It writes no agent configuration.
- **Removing it** is a short list of steps: see [Removing Otea](docs/security.md#removing-otea).

The sign-in key and the databases are as safe as your user account: code running as you can read them. Otea defends the desk against other users of the machine and against web pages, not against software you run yourself.

## Using Otea inside a company: the AGPL

Otea is under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). In plain words, and only as the license's own terms put them:

- **Using it inside your organization is fine.** Installing Otea on your team's computers and using it for your own work, unmodified, asks nothing of you: no payment, no registration, no source to publish.
- **Modifying it for your own use is fine too,** as long as you do not distribute it and do not offer it as a network service to people outside your organization. The AGPL's duties (section 5 for distributing, section 13 for network use) apply when you give copies to others, or let others interact with your modified version over a network. Then you must offer them the corresponding source of your version under the same license.
- **Giving it to others** (a customer, a partner, another company, in a product or as a hosted service) is where the AGPL applies fully: keep the license and notices, and publish the source of what you gave, with your changes.
- If that does not fit your use, for example embedding Otea in a closed product, a commercial license is available (see the [README](README.md#license)).

This is a reading of the license's plain terms, not legal advice. The license text governs; if your case is not clear, ask your company's counsel.
