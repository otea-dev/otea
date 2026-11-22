---
applyTo: "package.json,desktop/package.json,package-lock.json,desktop/package-lock.json,.github/**,THIRD_PARTY_NOTICES.md,LICENSE,CLA.md,release-please-config.json,desktop/electron-builder.yml,desktop/build/**,ui/src/main.tsx"
---

# Dependencies, licensing and workflows (HIGH)

The published package `@otea/cli` has six runtime dependencies on purpose (`@hono/node-server`, `@modelcontextprotocol/server`, `hono`, `uqr`, `yaml`, `zod`), all pinned exactly. Otea is AGPL-3.0-only with a commercial license, so what it ships must stay compatible with both.

## Dependencies and licenses

- **A new dependency at all:** ask whether Node, an existing dependency or ten lines of code would do. Say what it adds to the published package, the desktop installer and the UI bundle. A new runtime dependency is HIGH; a dev dependency is ASK.
- **License:** the new package and its transitive tree must be permissive (MIT, ISC, BSD, Apache-2.0, OFL for fonts) or AGPL-compatible. Flag GPL-incompatible, SSPL, BUSL, "non-commercial", no-license, or unknown ones, since the commercial license could not carry them.
- **Vendored or copied code** (including snippets, fonts, icons, images): needs its origin and license in `THIRD_PARTY_NOTICES.md` and the copyright notice kept. Flag code that looks pasted without attribution.
- **Pinning:** versions stay exact, no `^`, `~`, `latest`, git or tarball URLs. The lockfile must match `package.json`; flag a lockfile that adds registries other than npm, or `resolved` URLs to other hosts.
- **Install scripts:** `postinstall`, `preinstall`, `prepare` that download or run code, `node-gyp` native builds, or a package that has just changed owner.

## Workflows (`.github/workflows/`)

- **`pull_request_target`** (only `cla.yml` uses it): it runs with write access on the base repo, so it must never check out, build or run the pull request's code, or expand `${{ github.event.* }}` text (titles, branch names, comments) into a `run:` script. Pass such values through `env:`.
- **Permissions:** the default is `contents: read`. Flag a widened `permissions`, a job-level grant that is broader than the job needs, `id-token: write` or `secrets: inherit` outside the release workflows, and new use of secrets in jobs that run on pull requests.
- **Pinning:** third-party actions are pinned to a full commit SHA with a version comment, as they are now. Flag a tag or branch ref (`@v4`, `@main`).
- **Release path** (`release-please.yml`, `npm-publish.yml`, `desktop.yml`): npm publishing is trusted publishing that only stages; the workflow file name is what npm matches. Flag a token, a plain `npm publish`, a renamed workflow, or a change to what runs on tags.
- **Required checks:** `check (ubuntu-latest)`, `check (windows-latest)` and `cla`; renaming a job or matrix entry silently removes them. Do not weaken or skip tests in `ci.yml`.
- **`dependabot.yml`:** grouped updates and the `chore(deps)` prefix stay.
