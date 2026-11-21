# Development

Requirements: Node.js 22.18 or later (Node 24 recommended, see `.nvmrc`).

```sh
npm install
npm run check   # lint, typecheck and tests
```

Tests never touch your real `~/.otea`: the test setup gives every test file a temporary `OTEA_HOME`, and code that falls back to the home folder throws inside tests, so a test must pass `OTEA_HOME` in the env it hands to Otea.

Working on the UI itself: keep `otea serve` running and start `npm run dev:ui` in the Otea checkout for hot reload (it proxies `/auth`, `/api` and each project's `/p/<id>/api` to port 4400).

## Token budget

What an agent reads back costs tokens on every call, so output size is tested like behavior. `src/cli/token-budget.test.ts` measures the CLI text, the CLI `--json` and the MCP result of `show`, `list`, `board` (the index and one board), `create`, `claim`, `handoff`, `attach` and `wait`, plus the MCP tool definitions, on a full bug-triage item, and fails when one grows past its budget. Tokens are estimated as characters / 4, not counted by a tokenizer. `--json` results are compact JSON, one line, no indentation; MCP results are the CLI text in the words of the tools (JSON only under `otea mcp --json`). A second test there runs one work cycle (next --claim, show, update, ask, reply, handoff, next) on the CLI and over MCP and holds each surface to a budget for the whole cycle, request and response. `OTEA_TOKEN_REPORT=sizes.json npx vitest run src/cli/token-budget.test.ts` writes the current sizes; raise a budget only on purpose.

## The README's GIFs

`npm run demo:gifs` records the animated GIFs in `docs/images/` (`demo-*-light.gif` and `-dark.gif`, one pair for each scene: `agent-loop`, `phone-answer` and `matrix`) from the real desk, so they can be made again whenever the UI changes. It needs the built UI (`npm run build:ui`), Playwright's Chromium (`npx playwright-core install chromium`) and `ffmpeg` on the PATH. Each scene runs in a throwaway folder under the system temp dir (its own `OTEA_HOME` and a fictional English project, made on a computer that speaks English, never yours) with `otea serve` on port 4995, which the script stops by its process id when it is done. The agents' side of each scene is real `otea` commands; the person's side is a real browser page.

A GIF is a few settled states of the desk, not a screen recording: each state is a screenshot taken once the page is still, cropped to the part where the change happens (the item's page, the phone, the Matrix) and laid out about 700 px wide with a caption saying the advantage, then held about a second so it can be read. The states are joined by hard cuts, never cross-faded, so no frame holds two states at once. `--only loop,question,matrix` picks scenes, `--scheme light|dark` one theme and `--out <dir>` another output folder. Scenes live in `scripts/demo/flows.mjs`, the screenshots, the composer and the encoder in `scripts/demo/capture.mjs`; each GIF stays under 3 MB (the script stops if one does not).
