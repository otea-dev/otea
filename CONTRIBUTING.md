# Contributing to Otea

Thanks for your interest in Otea.

## Before you open a pull request

- Run `npm run check` (lint, type check, tests, the UI build and the build of the published package). CI runs the same on Linux, Windows and macOS.
- Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...), one reviewable unit of work per commit. Pull requests merge by rebase, so every commit lands on `main` as you wrote it, and release-please reads its subject. The `commits` check (`.github/workflows/commits.yml`) reads each commit of your pull request, not only its title, and accepts the types `feat`, `fix`, `perf`, `revert`, `docs`, `chore`, `ci`, `build`, `test`, `refactor` and `style`, plus the `Revert "..."` and merge commits GitHub makes. To see what it will say before you push: `node .github/scripts/check-commits.mjs origin/main HEAD`.
- The pull request description follows [the template](.github/pull_request_template.md): what and why, how you checked it, the risk, and a short checklist.
- A pull request from outside the maintainers gets an automatic GitHub Copilot review (maintainers' and bots' pull requests are not reviewed), driven by [`.github/copilot-instructions.md`](.github/copilot-instructions.md) and [`.github/instructions/`](.github/instructions/): it looks for what could hurt users (network exposure and auth, secrets, Electron security, files and processes, stored data, CLI and MCP contracts, dependencies, workflows), not for style, which the checks cover.
- New official modules and presets arrive through pull requests. Local modules and project presets need no approval: they live in your project's `.otea/`.

## Contributor License Agreement

Every contributor signs the [Otea CLA](CLA.md) once, before their first pull request is merged. When you open a pull request, a bot asks you to sign by commenting:

```
I have read the CLA Document and I hereby sign the CLA
```

You keep the copyright in your work. The CLA grants the maintainer the right to distribute your contribution under the AGPL and under other licenses, including the commercial license described in the [README](README.md#license). This is what lets Otea stay open source while offering a commercial license to those who cannot use the AGPL.

## Releasing

The owner decides when to release by merging one pull request. Nobody computes a version or makes a tag by hand.

[release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`) keeps one pull request open on `main`, titled `chore: release <version>`. It reads the conventional commits since the last release and proposes the next version of `@otea/cli` and of `desktop/package.json` together (one version, one `v<version>` tag), and it writes `CHANGELOG.md`. Below 1.0 a `feat:` bumps the minor, a `fix:` the patch, and a breaking change (`feat!:`, or a `BREAKING CHANGE:` footer) also the minor. `docs`, `chore`, `ci`, `build`, `test`, `refactor` and `style` commits do not bump the version and stay out of the changelog, so write a user-visible change as `feat:` or `fix:` and say in its subject what the user gets. The pull request updates itself on every push to `main`.

To release:

1. Read the release pull request (the version and the changelog) and merge it, with the same rebase merge as any other pull request. The required checks run on it like on any pull request.
2. The merge makes the workflow create the `v<version>` tag and the GitHub Release, with the changelog as its notes, and start the two release workflows on that tag:
   - `.github/workflows/desktop.yml` builds the installers on the three systems, tries them, and attaches them with `SHA256SUMS.txt` to the Release.
   - `.github/workflows/npm-publish.yml` checks the tag against the package version, packs and tries the package, and **stages** `@otea/cli` on npm.
3. **Approve the staged version on npm** (below). That is the only manual step after the merge.

The npm workflow does not publish, it stages (`npm stage publish`), so the version is not public until someone with 2FA approves it. When the staging works, the workflow opens an issue titled `Approve @otea/cli <version> on npm`, assigned to the owner and labeled `release` (GitHub emails the assignee), and writes the same text to the run's summary. In the issue:

1. Open `https://www.npmjs.com/package/@otea/cli`, then the **Staged Packages** tab, review the version and choose **Approve** (npm asks for 2FA). Or run `npm stage approve <stage-id>`, with the id from the issue.
2. Tick the checks in the issue (`npm view @otea/cli@<version> version`, a clean `npm i -g @otea/cli`), then close it.

A re-run of the workflow does not open a second issue while the first one is open. A version with a prerelease suffix is staged under the `next` tag, which `npm i -g @otea/cli` never installs.

How it fits together, for when something breaks:

- The workflow uses the run's `GITHUB_TOKEN`, with no secret. GitHub starts no workflow for what that token creates (the release pull request, the tag) except a `workflow_dispatch`. So `release-please.yml` starts `desktop.yml` and `npm-publish.yml` itself, with `gh workflow run --ref <tag>`, and runs `ci.yml` and `cla.yml` on the release pull request's branch so that the required checks exist. Because the tag push fires nothing, a release runs each workflow once. A `v*` tag pushed by a person still runs both workflows (and `desktop.yml` creates the Release then), which is the way to release by hand if `release-please.yml` ever fails.
- The two release workflows are not reusable workflows called from `release-please.yml`: npm trusted publishing checks the name of the workflow that calls `npm`, and for a called workflow it checks the caller's, so the trusted publisher on npm (`npm-publish.yml`) would stop matching.
- If a run of `npm-publish.yml` fails after the tag exists (a failing check, say), fix `main`, then run **Actions > Publish to npm > Run workflow** from the tag with **publish** checked. Nothing has reached npm before the staging step, so this is safe to repeat. The same for `desktop.yml` from the tag (it replaces the files on the Release).
- `bootstrap-sha` and `initial-version` in `release-please-config.json` only matter until the first release is merged: they cut the first changelog at a recent commit, and make the first version `0.1.0`. After it, the manifest records the version and they can be deleted.
- Moving to a GitHub App or personal access token for release-please (`token:` in the workflow) would make GitHub start the workflows by itself, and the dispatch steps could then go. Do not keep both, or each release runs twice.

The package is the compiled CLI (`dist/`, built by `npm run build`), the built UI (`ui/dist`), the presets and the schemas. `prepack` builds both, so `npm pack` and `npm publish` always carry a fresh build. Node does not strip types from files under `node_modules`, which is why an installed package runs `dist/` while a checkout runs `src/` directly. To try what would ship, run `npm pack`, then install the `.tgz` into a throwaway prefix (`npm i -g --prefix <folder> <file>.tgz`). A manual run of the npm workflow (Actions > Publish to npm > Run workflow, **publish** unchecked) does the checks, the pack and `npm stage publish --dry-run`, and stages nothing and opens no issue.

### One-time setup

- **GitHub:** in Settings > Actions > General, under Workflow permissions, check **Allow GitHub Actions to create and approve pull requests**. Without it release-please cannot open the release pull request.
- **npm:** see below.

### npm one-time setup

The workflow signs in to npm with trusted publishing (OIDC), so no token is stored, and it only stages: a person approves each version. The owner of the `@otea` scope sets it up once:

1. On npmjs.com, sign in as a member of the `@otea` organization who can publish the package.
2. Open the package: `https://www.npmjs.com/package/@otea/cli`, then **Settings**.
3. Under **Trusted publisher**, choose **GitHub Actions** and fill in: organization or user `otea-dev`, repository `otea`, workflow filename `npm-publish.yml`, environment name left empty.
4. Make it **stage-only**: leave **Allow npm publish** unchecked, so the publisher can only run `npm stage publish`. A plain `npm publish` from the workflow is rejected. Save.
5. Optional, once the first release works: under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, so only an approved staged version reaches npm.

There is no token fallback: npm plans to remove token publishing that bypasses 2FA in January 2027, and a stage-only publisher makes it pointless. Staging needs npm 11.15.0 or later, which the workflow installs.
