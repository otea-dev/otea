import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creatures, step } from '../core/board/testing.ts';
import { updateItemState } from '../store/queries.ts';
import {
  ackAssistantReturns,
  assistantWake,
  declareAssistant,
  startAssistantWait,
} from './assistant.ts';
import { createItem, getItem } from './items.ts';
import { claimItem } from './leases.ts';
import { handoffItem } from './next.ts';
import type { Project } from './project.ts';
import { memoryContext, projectOf, publishAs } from './testing.ts';

const you = { kind: 'human' as const, name: 'human' };
const quill = { kind: 'agent' as const, name: 'quill' };
const T0 = Date.parse('2026-11-27T10:00:00.000Z');

// A board with a land step after the person's review: an agent that hands it off closes the item as
// Done, as the one that lands the approved change does.
const landing = () => {
  const def = creatures();
  def.steps = [step('sdo', 'Hacer'), step('sland', 'Integrar', { reviewer: 'none' })];
  def.form = [{ ref: 'fdesc', required: true }];
  return def;
};

// Field study 5, V8: nine items reached Done during a half hour away and Hablar still showed the
// last message from before: nobody told the person. An agent closing an item as Done wakes the
// assistant, and several landings are one wake.
describe('the assistant hears what landed', () => {
  let project: Project;
  let tick = 0;
  const now = () => new Date(T0 + 1000 * ++tick).toISOString();
  const wake = () => assistantWake(project, startAssistantWait(now), now);
  // An item the person approved: it waits at the land step for an agent.
  const made = (title: string) => {
    const { id } = createItem(
      project,
      { collection: 'Criaturas', title, fields: { fdesc: 'Lenta' }, actor: you },
      now,
    );
    updateItemState(project.db, id, 'sland', now());
    return id;
  };
  const land = (id: string) => {
    claimItem(project, { id, actor: quill }, now);
    handoffItem(project, { id, actor: quill, channel: 'cli' }, now);
    expect(getItem(project, id).turn).toBe('none');
  };

  beforeEach(() => {
    const ctx = memoryContext();
    publishAs(ctx, landing(), 'bcri', now);
    project = projectOf('/nowhere', ctx);
    declareAssistant(project.db, 'sol', now);
  });

  afterEach(() => project.db.close());

  it('wakes for an item an agent closed as Done, and says to tell the person in one line', () => {
    const id = made('Add the price');
    expect(wake()).toBeUndefined();

    land(id);

    const woke = wake();
    expect(woke).toMatchObject({ kind: 'landed', ref: id, items: [id] });
    expect(woke?.text).toContain('«Add the price»');
    expect(woke?.text).toMatch(/one line/);
    expect(woke?.text).toMatch(/since my last message/);
  });

  it('batches several landings into one wake, then stops once the assistant acted', () => {
    const ids = ['One', 'Two', 'Three'].map(made);
    for (const id of ids) land(id);

    const woke = wake();

    expect(woke?.kind).toBe('landed');
    expect(woke?.items).toEqual(ids);
    expect(woke?.text).toContain(ids.join(','));
    ackAssistantReturns(project.db, 'sol', now, []);
    expect(wake()).toBeUndefined();
  });

  it('brings the landings back to a later wait if the assistant did not act, once more at most', () => {
    const ids = ['One', 'Two'].map(made);
    for (const id of ids) land(id);
    expect(wake()?.items).toEqual(ids);

    expect(wake()?.items).toEqual(ids);
    expect(wake()).toBeUndefined();
  });

  it('says nothing for an item that has only been made', () => {
    made('Mine');

    expect(wake()).toBeUndefined();
  });
});

describe('a project with no assistant', () => {
  it('keeps no landing for one that comes later', () => {
    let tick = 0;
    const now = () => new Date(T0 + 1000 * ++tick).toISOString();
    const ctx = memoryContext();
    publishAs(ctx, landing(), 'bcri', now);
    const project = projectOf('/nowhere', ctx);
    try {
      const id = createItem(
        project,
        { collection: 'Criaturas', title: 'Early', fields: { fdesc: 'Lenta' }, actor: you },
        now,
      ).id;
      updateItemState(project.db, id, 'sland', now());
      claimItem(project, { id, actor: quill }, now);
      handoffItem(project, { id, actor: quill, channel: 'cli' }, now);

      declareAssistant(project.db, 'sol', now);

      expect(assistantWake(project, startAssistantWait(now), now)).toBeUndefined();
    } finally {
      project.db.close();
    }
  });
});
