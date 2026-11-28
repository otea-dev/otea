import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.ts';
import { migrate } from '../store/migrations.ts';
import { selectListenerProcesses } from '../store/queries.ts';
import { noteHarness, seeAgent } from './presence.ts';

const at = () => '2026-11-27T10:00:00.000Z';

// Adversarial review of S: an impersonator's first wait overwrote the harness noted for the
// secretary and took the binding. A live harness noted for a name is not replaced by another's.
describe('the harness noted for an agent', () => {
  const agentWith = () => {
    const db = openDatabase(':memory:');
    migrate(db);
    seeAgent(db, { agent: 'sol', channel: 'cli', call: true }, at);
    return db;
  };
  const noted = (db: ReturnType<typeof agentWith>) =>
    selectListenerProcesses(db).get('sol')?.harness ?? null;

  it('is not replaced by another live harness’s, and is by one once the first is gone', () => {
    const db = agentWith();
    noteHarness(db, 'sol', 100, at, true, 1_700_000_000_000, () => true);

    noteHarness(db, 'sol', 200, at, true, 1_700_000_100_000, (pid) => pid === 100 || pid === 200);
    expect(noted(db)).toBe(100);

    noteHarness(db, 'sol', 200, at, true, 1_700_000_100_000, (pid) => pid === 200);
    expect(noted(db)).toBe(200);
    expect(selectListenerProcesses(db).get('sol')?.harnessStarted).toBe(1_700_000_100_000);
    db.close();
  });

  // D-6f56ce: a wait that runs under a harness the noted one started is the same session: it is
  // not a loser (the secretary's wait ended with «runs in another session» and it retired), and it
  // does not take the binding from the harness above it.
  it('takes a wait under a harness the noted one started for the same session', () => {
    const db = agentWith();
    noteHarness(db, 'sol', 100, at, true, 1_700_000_000_000, () => true);

    const same = noteHarness(db, 'sol', 170, at, true, 1_700_000_050_000, () => true, [100, 1]);
    expect(same).toBe(true);
    expect(noted(db)).toBe(100);

    // Not one that merely lives beside it.
    expect(noteHarness(db, 'sol', 300, at, true, 1_700_000_100_000, () => true, [1])).toBe(false);
    expect(noted(db)).toBe(100);
    db.close();
  });
});
