# STATUS

- Phase: 0.8 "the secretary" (SPEC.md). M1 done: the secretary role and its wait. 0.7.0 released 2026-11-25 (npm 2FA pending in issue #650).
- Broken: nothing known on main (CI green).
- M1 delivers: `otea profile --role secretary` / `otea connect --as <n> --role secretary` (one per project; a gone one is replaced), `otea wait --secretary --as <n>` (wakes on person_message, bandeja_item, escalation signals and on unheard board work after the notifier's grace), the secretary is never a board listener (`waiting` false, `attending` true, `role` on every agent), `GET /api/secretary` (listening / connected / offline since), whoami lines. M2 and M5 emit signals with `emitSecretarySignal` (app/secretary.ts); the escalation source (a worker's question to the secretary) is only the signal kind so far.
- Next: M2 (conversation: per-project message store, `otea say`, `otea conversation`, desk route that emits `person_message`).
- Last command: `npm run check` on M1: lint, typecheck, builds ok; 620 files / 6709 tests, 2 stale version pins (schema 42 -> 43, connect usage) fixed and re-run green (4 files, 97 tests).
