# Contributing to Otea

Thanks for your interest in Otea.

## Before you open a pull request

- Run `npm run check` (lint, type check, tests, the UI build and the build of the published package). CI runs the same on Linux, Windows and macOS.
- Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...), one reviewable unit of work per commit.
- New official modules and presets arrive through pull requests. Local modules and project presets need no approval: they live in your project's `.otea/`.

## Contributor License Agreement

Every contributor signs the [Otea CLA](CLA.md) once, before their first pull request is merged. When you open a pull request, a bot asks you to sign by commenting:

```
I have read the CLA Document and I hereby sign the CLA
```

You keep the copyright in your work. The CLA grants the maintainer the right to distribute your contribution under the AGPL and under other licenses, including the commercial license described in the [README](README.md#license). This is what lets Otea stay open source while offering a commercial license to those who cannot use the AGPL.

## Releasing

A release is one `v*` tag. The tag publishes the desktop installers as a GitHub Release (`.github/workflows/desktop.yml`) and the `@otea/cli` package to npm (`.github/workflows/npm-publish.yml`), which stages it and waits for the owner's approval (last step below). The npm job refuses a tag that is not the `version` in the root `package.json`, so bump it on `main` first:

```sh
npm version 0.2.0 --no-git-tag-version   # also commit the change, through a pull request
git tag v0.2.0 && git push origin v0.2.0
```

`desktop/package.json` takes its version from the tag in CI, so it is not bumped by hand. A tag with a prerelease suffix (`v0.2.0-rc.1`) is staged under the `next` tag, which `npm i -g @otea/cli` never installs.

The last step is yours: **approve the staged version on npm.** The workflow does not publish, it stages (`npm stage publish`), so the version is not public until someone with 2FA approves it. When the staging works, the workflow opens an issue titled `Approve @otea/cli <version> on npm`, assigned to the owner and labeled `release` (GitHub emails the assignee), and writes the same text to the run's summary. In the issue:

1. Open `https://www.npmjs.com/package/@otea/cli`, then the **Staged Packages** tab, review the version and choose **Approve** (npm asks for 2FA). Or run `npm stage approve <stage-id>`, with the id from the issue.
2. Tick the checks in the issue (`npm view @otea/cli@<version> version`, a clean `npm i -g @otea/cli`), then close it.

A re-run of the workflow does not open a second issue while the first one is open.

The package is the compiled CLI (`dist/`, built by `npm run build`), the built UI (`ui/dist`), the presets and the schemas. `prepack` builds both, so `npm pack` and `npm publish` always carry a fresh build. Node does not strip types from files under `node_modules`, which is why an installed package runs `dist/` while a checkout runs `src/` directly. To try what would ship, run `npm pack`, then install the `.tgz` into a throwaway prefix (`npm i -g --prefix <folder> <file>.tgz`). A manual run of the npm workflow (Actions › Publish to npm › Run workflow) does the checks, the pack and `npm stage publish --dry-run`, and stages nothing and opens no issue.

### npm one-time setup

The workflow signs in to npm with trusted publishing (OIDC), so no token is stored, and it only stages: a person approves each version. The owner of the `@otea` scope sets it up once:

1. On npmjs.com, sign in as a member of the `@otea` organization who can publish the package.
2. Open the package: `https://www.npmjs.com/package/@otea/cli`, then **Settings**.
3. Under **Trusted publisher**, choose **GitHub Actions** and fill in: organization or user `otea-dev`, repository `otea`, workflow filename `npm-publish.yml`, environment name left empty.
4. Make it **stage-only**: leave **Allow npm publish** unchecked, so the publisher can only run `npm stage publish`. A plain `npm publish` from the workflow is rejected. Save.
5. Optional, once the first release works: under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, so only an approved staged version reaches npm.

There is no token fallback: npm plans to remove token publishing that bypasses 2FA in January 2027, and a stage-only publisher makes it pointless. Staging needs npm 11.15.0 or later, which the workflow installs.
