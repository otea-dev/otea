# SPEC: Otea 0.8, the assistant

## 1. Goal

The person talks to one AI assistant per project and decides; they no longer babysit agents. From the desk or the phone, the new **Hablar** view is a chat with that project's assistant, which lives in the person's own harness session on their PC. The assistant turns what the person says into **requests** (items, board drafts) or **consultations** (saved Q&A), shows which, and keeps workers running. A rough note captured from the phone lands in a **Bandeja** and a refiner subagent turns it into a proper item, asking what's missing with buttons. Every request/consultation shows the items it produced, and every item links back to the conversation. When the assistant is offline, messages wait and the person is told. Notifications cover only what needs the person.

## 2. Non-goals

- Otea launching or keeping agents alive (it shows who is missing; harnesses launch).
- Recorded voice notes / transcription (phone keyboard dictation only).
- Per-board review policy and the independent reviewer (0.9).
- A cloud relay; push to the phone stays Tailscale or the desktop app.
- One assistant across projects.

## 3. Constraints (locked; see D:\otea-explore\report\0.8-decisions.md)

1. One assistant per project, in that project's harness session, with its context. Hablar is one conversation per project; Te toca still joins all projects.
2. The assistant classifies each message as request or consultation by itself and shows it ("Pedido → CAM-12" / "Consulta guardada"); unsure → two buttons; the person corrects with one tap.
3. Attachments: images/screenshots and files (PDF, text…). No audio.
4. Quick capture → Bandeja → a refiner subagent fills What I want / How I check it, asks on the item with options, files it on its board. No subagents → the assistant does it.
5. Assistant offline: Hablar says since when; the person keeps writing and capturing; all is kept and processed in order on return; one notice if a message waited long.
6. Notify: an agent's question (with options), the assistant's reply, an item reaching the person's review, something down (assistant offline with waiting messages, a board with nobody). Everything else waits in Te toca.
7. Same way of working with or without subagents: without them the assistant tells the person how many sessions to open and the exact text for each.
8. Traceability both ways (conversation turn ⇄ items/boards/consultation).
9. Look: DESIGN.md Editorial, the Hablar mock (D:\otea-explore\report\hablar-v2.html): lanes (assistant | tú), nodes with their looks, lane light, a branch of item chips per request, an assistant colour of its own (new token), "pensando…", composer with attach + suggestions, "Lo que salió" column (desk) / tab (phone). Spanish de tú.
10. Person-only acts go through the desk's authenticated routes; an agent can never post as the person. Questions use 0.7's options (`otea ask --option`).
11. No backwards compatibility needed (Otea is not in real use). Topics become consultations.

## 4. Context

- Agents: `src/app/agents.ts`, `agent-status.ts` (listening/working), `src/core/agent-status.ts` (`itemUnheard`), `src/app/keep-waiting.ts`, the `wait` command in `src/cli/commands.ts`.
- Topics today: `src/app/topics.ts`, `topics-everywhere.ts`, `src/server/topics*`, `ui/src/views/topics`.
- Questions with options: `src/app/questions.ts`, `src/core/board/questions.ts`.
- Notifications: `src/core/notify/*`, `src/server/notifier.ts`, `desktop/src/live.ts`.
- Role texts: `src/core/agent-prompts.ts`, `src/app/agent-prompts.ts`, agent guide `src/core/agent-guide.ts`.
- Attachments: `src/server/attach-files*`, evidence storage.
- Desk: `ui/src/views/*`, `ui/src/lanes/*`, `ui/src/motion/*`, `ui/src/styles/tokens.css`, i18n `ui/src/i18n/{en,es}`.
- Checks: `npx vitest run <files> --maxWorkers=2`, `npm run typecheck`, `npm run check` once per push; desk in a real browser with agent-browser (390 / 1280), own temp OTEA_HOME, `serve --no-open`.

## 5. Milestones

- **M1 Assistant role and its wait.** A project has at most one assistant agent (declared with `otea profile --role assistant` or `otea connect --role assistant`). `otea wait --assistant` (and MCP) wakes on: a new person message, a Bandeja item, a board with work and nobody listening, a question escalated to it. The desk no longer counts the assistant as listening on boards (the unheard notice works again). API/desk expose assistant status: connected / offline since T. Tests: `src/app/assistant.test.ts`, `src/cli/assistant-wait.test.ts`. Files: app/agents, agent-status, cli wait, server.
- **M2 Conversation.** Per-project message store: person and assistant messages, attachments (images/files, existing size limits), order, delivered/pending state. Person posts via desk route only; assistant reads/replies via `otea say <text> [--file]` / MCP `say` and `otea conversation` / MCP read tool. A message can be marked request (links to items/board drafts it produced) or consultation (question + answer = what topics are now; topics data migrates or is replaced). One-tap correction by the person. Item ⇄ message backlinks. Tests: `src/app/conversation.test.ts`, `src/server/conversation.test.ts`, `src/cli/say.test.ts`.
- **M3 Hablar view (desk + phone).** As the mock: lanes, nodes, branch chips with live state, thinking state while the assistant holds the turn, composer with attach and suggestions, Lo que salió (column ≥ 1240 px, tab on phone), offline banner, backlink from an item page to its turn. Motion per DESIGN.md (message unfolds from its node; branch draws with ink; reduced motion = 160 ms fade). Tests: `ui/src/views/hablar/*.test.tsx`; real-browser check at 390 and 1280 with screenshots.
- **M4 Short answers.** Assistant output rule in its text and in the guide: one-line conclusion first, then at most a few lines; long content as an attachment/page; questions always with options. Tests on the role text; a desk test that a long assistant message folds behind "ver más".
- **M5 Bandeja and refiner.** "Nuevo ítem" free text + attachments → Bandeja (a per-project inbox, not a board). Assistant wakes; launches a refiner (`otea prompt --role refiner`) or refines itself; refiner asks on the item with options; files it on a board with What I want / How I check it; Bandeja shows state. Tests: `src/app/bandeja.test.ts`, CLI/MCP for refiner flow.
- **M6 Notifications.** New kinds: assistant reply; assistant offline with person messages waiting (once). Respect existing switches, quiet hours, grace. Tests in `src/core/notify/*.test.ts`, `src/server/notify.test.ts`.
- **M7 Role texts and fallback.** `otea prompt --role assistant` (replaces coordinator), `worker`, `refiner`; assistant text covers: classify, keep workers, launch refiner, reply short, wait with `--assistant`, and the no-subagents fallback (tell the person how many sessions to open and print each text). Docs: working-with-agents canon section, README pointer. Tests: `src/core/agent-prompts.test.ts`.

## 6. End-to-end check

`npx vitest run src/e2e/assistant.e2e.test.ts` — one test drives a real server and CLI agents: the person posts "the Aprobar button is hidden on the phone" with an image via the desk API; the assistant's `wait --assistant` returns; it replies with `say`, creates an item linked as a request; a worker picks it up and asks with options; the person answers by option via the desk; a raw Bandeja capture is refined and filed; the assistant goes offline, the person posts, the message waits and is delivered on return; item → message and message → item links resolve. Plus the real-browser screenshots of Hablar at 390 and 1280.

## 7. Open decisions (default taken)

- Assistant colour: a new token `--assistant` (lilac), used only for the assistant. Default: yes.
- Message format: plain text with links and item ids; no markdown rendering. Default: plain.
- Retention: keep all messages; consultations searchable. Default: keep.
- Suggestions in the composer: "¿Qué me espera hoy?", "Resumime lo que se hizo", "Armá un tablero para…". Default: these three, static.
- Bandeja is per project; a capture without project on the phone goes to the last project used. Default: yes.
- Topics: replaced by consultations (no migration needed: no real users). Default: replace.
- Overlapping approvals (R3, resolved, approved by the owner 2026-11-27; evidence: field study 4 W/u6 API-5/7/8, field study 5 V2 and V4): approving an item that overlaps (a recorded same-file overlap) another that is approved-not-landed or landing does not send it to Land yet: it waits as «aprobado · espera a X» (en «approved · waits for X»), shown on the board row, the item page, Te toca, Hablar's chips and the phone, in `otea pending` and the assistant's texts. When X lands, the item's agent merges main into it first; a clean merge with passing checks re-enters the person's review once as a merge-only round (0.7), a conflict is resolved by the agent and comes back once with the resolution; the person never sees a bounce for items approved together. A chain waits in line (an item back for its merge review still goes first); X sent back or dropped releases the item to Land as any other; non-overlapping approvals are unchanged. Otea enforces it: a closing handoff of an item whose overlapping peers landed ahead is refused until the merge round was reviewed.
