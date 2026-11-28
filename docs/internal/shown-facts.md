# Facts the desk and the phone show

The owner's rule: what Otea shows must be true. A fact that is derived from state is computed once,
and every surface reads that one answer. This is the inventory (taken at 0.8, branch
`feat/0.8-secretary`), what each fact had before, and what it is now. Invariant tests are in the
last column; `AGENTS.md` lists them as invariants.

«Before» counts the independent computations of the fact (a second place that re-derives it, not a
second place that reads it). 24 facts are listed: 13 had more than one source before this change, and
all 13 have one now.

| # | Fact | Surfaces | Source before | Source now | Guard |
|---|---|---|---|---|---|
| 1 | The number of things that wait for the person | rail badge, tab bar, phone sheet, project menu, tab title and favicon, Te toca's dek, Hablar's «Te espera», `otea pending` header and the line at the foot of a wait, the projects overview and «Todos los proyectos», the desktop tray and taskbar overlay | 6: the desk's `tocaCount` and the dek's own sum, `pendingOf.count`, the overview's `countsOf`, the notifier's `signalsOf`, the tray's `attentionOf` (your turn only) | `core/waiting.ts` (`waitsForPerson`, `countedOff`) and `core/pending.ts` (`counted`); the desk's one formula is `waitingTotal` (`ui/src/pending.ts`) | `src/app/shown-facts.test.ts`, `ui/src/shown-facts.test.tsx` |
| 2 | An item is stuck (an agent's lease ran out, nobody took it again) | Atasco, rail, Te toca, overview, push notice, `otea pending` | 4 readings: the desk's, the server's (`!item.lease`), the overview's (ignored «its agent is still connected»), the notifier's (the same) | `core/waiting.ts` `isStuck` | `shown-facts` tests |
| 3 | A question of the assistant about an item that already waits | Te toca, Hablar's strip, `otea pending`, counts | listed and counted as a second thing (D-3c918d) | `isCovered`: listed with the item, counted once | `shown-facts` tests |
| 4 | «Questions for you» | Te toca's section and its count | included reports of agents and boards with no agent (D-0454fd, D-35c7b8) | questions only; reports and boards with no agent have their own headings (`sec:avisos`, `sec:sinagente`) | `ui/src/shown-facts.test.tsx` |
| 5 | A board's «yours / open» | rail rows, phone sheet | your turn only (the badge counted what is stuck too) | `waitsForPerson` | `ui/src/derive/toca.test.ts` |
| 6 | The assistant's state (listening, connected, offline since) | rail dot, phone sheet, Hablar's header, status line and away strip, Te toca's card, Hablar's thinking state | 4 reads: `/api/conversation`, `/api/assistant`, `/api/pending`, the agents list; the first two refreshed only on an item change, so Hablar kept «connected» after the menu dropped it (D-51081c) | one server function (`assistantView`), read once by the desk (`app.assistant`, on every change and presence event) | `ui/src/shown-facts.test.tsx`, `src/app/shown-facts.test.ts` |
| 7 | Whether a new session may take the assistant's role | `otea profile --role assistant`, the offline banner's instructions | the status said offline and `declareAssistant` had a second reading of «gone» (D-5645a2) | `declareAssistant` asks `assistantStatus`: allowed exactly when it reads offline | `src/app/shown-facts.test.ts` |
| 8 | What waits for the assistant | Hablar's away strip, Te toca's offline card, the notifier's «offline with messages waiting» | `conversation.waiting` (messages) and `pending.assistant.waiting` (messages, notes and reports) under one name (D-fbe122) | `assistantWaiting`: messages, notes, reports and their sum; both screens say it by parts (`waitingWords`) | `shown-facts` tests |
| 9 | «Agents» (the pill, its menu, «no agent is connected») | agents pill and menu, notices on items and boards, the switcher's agent list | the pill counted the assistant and refiners, the notices did not: «1 listening» and «no agent connected» at once | `workersOf` (the agents that take items) on the pill, the menu, the notices and the projects overview; the assistant has its own place | `ui/src/shown-facts.test.tsx` |
| 10 | What an agent is doing (working, listening, connected, silent, away) | pill, menu, rows, agent sheet | `core/agent-status.ts` (the desk reads its word) | unchanged: one | `src/core/agent-status.test.ts` |
| 11 | An item nobody hears | Te toca, board rows, item page, push notice | `itemUnheard` in `core/agent-status.ts`, read by the desk and the notifier | unchanged: one | `src/core/agent-status.test.ts` |
| 12 | A board with no worker for its waiting items | Te toca (`worker` entries), `otea pending`, the assistant's wake | server only (`queuesOf`, 3 minutes) | unchanged: one | `src/app/pending.test.ts` |
| 13 | Whose turn it is (yours, agent, none) | every row, lane and badge | the server's `turnOf(workflow, state)` as `item.turn`; the desk reads it | unchanged: one | `src/app/items.test.ts` |
| 14 | An item's state label | rows, item page, Triage, notices | the type's or board's own word (`stateWord`) | unchanged: one | `ui/src/preset-words.test.ts` |
| 15 | The round of an item | rows, Triage, item page, route diagram, push key | on a board the server's `boardRoundOf` (`item.round`), read by all; off a board three desk fallbacks with three formulas (`views/toca/blocks.tsx`, `views/board/model.ts`, `triage.ts`) | one on and off a board: `roundOf` in `ui/src/rounds.ts` (`item.round` when the server sends it; else one plus every time the person sent it back with notes), called by Te toca's row, the board's rows and steps and Triage's card | `ui/src/shown-facts.test.tsx` (the card and the selector agree; the function is defined once), `ui/src/rounds.test.ts` |
| 16 | «Waits for X» (approved while an overlapping change lands first) | board row, item page, Te toca, Hablar's chips, `otea pending` | `landWaitOf` (`approval-wait.ts`), served as `item.landsAfter` | unchanged: one | `src/app/approval-wait.test.ts` |
| 17 | Landing state (approved, waiting to land, merging, came back) | rows, item page, `otea pending` | `stepFactsOf` | unchanged: one | `src/app/step-facts.test.ts` |
| 18 | «Today they handed over N, you approved M» | Te toca's recap | the desk, from the feed's newest 200 events: it went down as the afternoon went on (D-a55c6d) | the same count, over a feed that keeps every event of the day (`mergeFeed(…, today)`, `firstFeed`) | `ui/src/views/toca/today-busy-day.test.ts` |
| 19 | The Triage count and the card on top | Triage | the desk's `tocaSection` = revisiones (the reviews of Te toca) | unchanged: one classification | `ui/src/triage.test.ts` |
| 20 | Closed work (Cerrados, Hecho, Descartado, «done in the last 24 h») | Te toca, boards, `otea pending` | three windows by design: 7 days (Te toca), all (boards), 24 hours (`pending.done`) | unchanged, each labelled with its own window | `ui/src/views/toca/TocaView.test.ts` |
| 21 | Notes that ask the person (Bandeja) | «Lo que salió» tab, Te toca, rail count | `listBandeja`'s `asking` read twice: `/api/bandeja` for the tab and `/api/pending` for the rest | the tab's number is `bandejaAsking(app.pending)` (`ui/src/pending.ts`): the entries of kind `bandeja` that `/api/pending` lists, read once with the rest of pending; the Bandeja's own list draws the notes and never counts | `ui/src/shown-facts.test.tsx`, `ui/src/views/hablar/Bandeja.test.tsx`, `src/app/pending.test.ts` |
| 22 | The desktop app's tray count and overlay | tray, taskbar overlay, flash on «something new is yours» | your turn only, no stuck, no non-item | `waitingCount` over the items and `/api/pending` | `desktop/src/state.test.ts` |
| 23 | What Otea did itself (a migration, a retitle, a diff it computed, the starting boards) | item history, feed, notes, diff signature | written as the person's (`kind: 'human', name: 'otea'` in four places) | `OTEA_ACTOR` (`kind: 'otea'`) | `src/app/otea-acts.test.ts` |
| 24 | Whether the PC answers | offline line, composer, assistant state on the phone | `app.sync` | unchanged: one | `ui/src/offline/sync-state.test.ts` |

## How a fact stays single

- A rule that two places need goes in `src/core` and both import it (`core/waiting.ts`); the desk
  never re-derives what the server already says (`item.turn`, `item.round`, `agent.status`).
- A number a screen shows is a selector the other screens call (`waitingCount`, `offItemEntries`,
  `app.assistant`), not a formula repeated at the call site.
- A new payload that repeats a fact of another (the assistant inside the conversation) is built by the
  same server function as the first (`assistantView`), and the desk reads one of them.
- A new surface that shows a count gets a row here and an assertion in `ui/src/shown-facts.test.tsx`.
