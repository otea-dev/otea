#!/usr/bin/env bash
# Tells the owner that a version of @otea/cli is staged on npm and waits for their approval.
# Opens a GitHub issue assigned to the owner (GitHub emails them), writes the same text to the job
# summary and emits a ::notice annotation. Run by .github/workflows/npm-publish.yml after
# `npm stage publish`.
#
# Needs: VERSION, STAGE_ID, GH_TOKEN (issues: write), GITHUB_REPOSITORY, and `gh` on the PATH.
# GITHUB_STEP_SUMMARY and RUNNER_TEMP are optional, for running it outside Actions.
set -euo pipefail

: "${VERSION:?}" "${STAGE_ID:?}" "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
owner="${OTEA_RELEASE_OWNER:-Lartweib}"
title="Approve @otea/cli ${VERSION} on npm"
package_url="https://www.npmjs.com/package/@otea/cli"
body_file="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/npm-stage-issue.XXXXXX")"

cat > "$body_file" <<BODY
\`@otea/cli ${VERSION}\` is staged on npm. It is **not public until you approve it**: \`npm i -g @otea/cli\` does not see it yet.

- Stage id: \`${STAGE_ID}\`
- Approve on npmjs.com: open ${package_url}, then the **Staged Packages** tab, review the version and choose **Approve** (2FA).
- Or from a terminal (also asks for 2FA): \`npm stage approve ${STAGE_ID}\`
- Not right? \`npm stage reject ${STAGE_ID}\`, or **Reject** on the same tab.

After approving:

- [ ] \`npm view @otea/cli@${VERSION} version\` prints ${VERSION}
- [ ] \`npm i -g @otea/cli\` installs it and \`otea --version\` says ${VERSION}
- [ ] Close this issue
BODY

# The same text goes to the job summary and to an annotation, so it shows even if the issue fails.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { printf '## %s\n\n' "$title"; cat "$body_file"; } >> "$GITHUB_STEP_SUMMARY"
fi
echo "::notice title=${title}::Staged with id ${STAGE_ID}. Approve it on ${package_url} (Staged Packages tab) or run: npm stage approve ${STAGE_ID}"

# A re-run must not open a second issue for the same version.
export TITLE="$title"
existing="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "\"${title}\" in:title" \
  --limit 100 --json number,title --jq '[.[] | select(.title == env.TITLE)][0].number // empty')"
if [ -n "$existing" ]; then
  echo "Issue #${existing} for ${VERSION} is already open: not opening another"
  exit 0
fi

gh label create release --repo "$GITHUB_REPOSITORY" --color 0e8a16 \
  --description "Needs a release step from the owner" 2>/dev/null || true

if ! gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$body_file" \
  --label release --assignee "$owner"; then
  # The version is already staged, so the notice must not be lost over an assignee that cannot be set.
  echo "::warning::Could not assign the issue to ${owner}: opening it without an assignee"
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$body_file" --label release
fi
