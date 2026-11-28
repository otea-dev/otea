import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures } from '../core/board/testing.ts';
import { appendEvent } from '../store/queries.ts';
import { createItem, getItem } from './items.ts';
import { dropItem } from './next.ts';
import type { Project } from './project.ts';
import { reopenDropped } from './reopen-dropped.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 27, 10, 0, ++tick)).toISOString();

// Adversarial review of S: a discard taken back must land somewhere the board still has.
describe('reopening a discard whose step the board no longer has', () => {
  let project: Project;
  let id: string;

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, creatures(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    id = createItem(
      project,
      { collection: 'Criaturas', title: 'Rana', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).id;
    dropItem(project, { id, actor: you, channel: 'ui', via: 'page', reason: 'no' }, now);
  });

  afterEach(() => project.db.close());

  it('puts the item at the first step instead of a state that is gone', () => {
    // Where a new item of this board starts.
    const first = createItem(
      project,
      { collection: 'Criaturas', title: 'Sapo', fields: { fdesc: 'Lenta' }, actor: you },
      now,
    ).state;
    // The discard as the board left it before a step went: its last move comes from a state that
    // the board does not have any more.
    appendEvent(project.db, {
      itemId: id,
      type: 'transitioned',
      actor: you,
      at: now(),
      data: { from: 'a_step_that_is_gone', to: 'dropped' },
    });

    const reopened = reopenDropped(project, { id, actor: you, channel: 'ui' }, now);

    expect(reopened.state).toBe(first);
    expect(getItem(project, id).state).toBe(first);
  });
});
