# Agents

Notes for any agent working in this repository. Project commands are in `package.json`
(`npm run check` is the full gate; targeted tests: `npx vitest run <files> --maxWorkers=2`).

## Invariants

A change that touches an invariant runs its guard test. A new invariant gets a row and a test.

The owner's rule: what Otea shows must be true. One inconsistency (a «no agents» while two agents
show) costs the trust of the whole product, so a fact has one source and every surface reads it.
`docs/internal/shown-facts.md` lists every fact the desk and the phone derive from state, where it is
computed and what reads it.

| Invariant | Guard test |
|---|---|
| What waits for the person is one rule (`src/core/waiting.ts`: your turn, or stuck; a secretary question about an item that waits is that item, counted once). `otea pending`, the projects overview, the notifier, the desk's rail, tab bar, title, Te toca, Hablar's strip and the tray all give the number the rule gives | `src/app/shown-facts.test.ts`, `ui/src/shown-facts.test.tsx` |
| The sections of Te toca add up to its number; a report from an agent and a board with no agent are not «Questions for you» | `ui/src/shown-facts.test.tsx` |
| The secretary's state and what waits for it are one object (`secretaryView`, read once by the desk as `app.secretary`); a new session may take the role exactly when it reads offline; what waits is said by what each is (messages, notes, reports), never as messages | `src/app/shown-facts.test.ts`, `ui/src/shown-facts.test.tsx` |
| «Agents» are the agents that take items: the pill, its menu and the notices count the same ones; the secretary has its own place | `ui/src/shown-facts.test.tsx` |
| The day's recap never says less than it said (the feed keeps the whole day) | `ui/src/views/toca/today-busy-day.test.ts` |
| What Otea writes on its own is signed `otea`, never as the person: no event or record of Otea's own code carries `kind: 'human'` | `src/app/otea-acts.test.ts`, `src/app/board-migration.test.ts` |
