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
});
