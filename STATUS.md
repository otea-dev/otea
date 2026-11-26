# STATUS

- Phase: 0.8 "the secretary" (SPEC.md). M1 done (with its review fixes): the secretary role and its wait. 0.7.0 released 2026-11-25 (npm 2FA pending in issue #650).
- Broken: nothing known on main (CI green).
- M1 delivers: `otea profile --role secretary` / `otea connect --as <n> --role secretary` (one per project; replaced only once really gone: session ended, or not heard for 30 min), `otea wait --secretary --as <n>` (wakes on person_message, bandeja_item, escalation signals and on unheard board work after the notifier's grace), `GET /api/secretary` (listening / connected / offline since), whoami lines, never a board listener (`waiting` false, `attending` true, `role` on every agent).
- Delivery: a wait returns a signal or stretch; it stays open until the secretary acts (its next otea command that is no secretary wait), and a later wait returns it again once more at most; taking is atomic. Seam for M2/M5: `emitSecretarySignal` (nudges) or `addSecretarySource` (pending derived from the records' own state, returned on every look while so). The escalation source (a worker's question to the secretary) is only the signal kind so far.
- Next: M2 (conversation: per-project message store, `otea say`, `otea conversation`, desk route that emits `person_message` or registers a source).
- Last command: `npm run check` on the M1 fix round: lint, typecheck, builds ok; 620 files / 6716 tests passed.
