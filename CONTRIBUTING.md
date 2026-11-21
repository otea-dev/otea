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

A release is one `v*` tag. The tag publishes the desktop installers as a GitHub Release (`.github/workflows/desktop.yml`) and the `@otea/cli` package to npm (`.github/workflows/npm-publish.yml`). The npm job refuses a tag that is not the `version` in the root `package.json`, so bump it on `main` first:

```sh
npm version 0.2.0 --no-git-tag-version   # also commit the change, through a pull request
git tag v0.2.0 && git push origin v0.2.0
```

`desktop/package.json` takes its version from the tag in CI, so it is not bumped by hand. A tag with a prerelease suffix (`v0.2.0-rc.1`) publishes to npm under the `next` tag, which `npm i -g @otea/cli` never installs.

The package is the compiled CLI (`dist/`, built by `npm run build`), the built UI (`ui/dist`), the presets and the schemas. `prepack` builds both, so `npm pack` and `npm publish` always carry a fresh build. Node does not strip types from files under `node_modules`, which is why an installed package runs `dist/` while a checkout runs `src/` directly. To try what would ship, run `npm pack`, then install the `.tgz` into a throwaway prefix (`npm i -g --prefix <folder> <file>.tgz`). A manual run of the npm workflow (Actions › Publish to npm › Run workflow) does the checks, the pack and `npm publish --dry-run`, and publishes nothing.

### npm one-time setup

The workflow signs in to npm with trusted publishing (OIDC), so no token is stored. The owner of the `@otea` scope sets it up once:

1. On npmjs.com, sign in as a member of the `@otea` organization who can publish the package.
2. Open the package: `https://www.npmjs.com/package/@otea/cli`, then **Settings**.
3. Under **Trusted publisher**, choose **GitHub Actions** and fill in: organization or user `otea-dev`, repository `otea`, workflow filename `npm-publish.yml`, environment name left empty. Save.
4. Optional, once the first release works: under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, so only the workflow can publish.

Fallback, if trusted publishing is not available: create a granular access token on npmjs.com (read and write, only the `@otea/cli` package), save it as the repository secret `NPM_TOKEN` (Settings › Secrets and variables › Actions) and the workflow uses it instead. Provenance is still published.
