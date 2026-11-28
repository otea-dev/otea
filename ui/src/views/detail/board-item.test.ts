import { describe, expect, it } from 'vitest';
import { sequenceIds } from '../../../../src/core/board/ids.ts';
import type { Part } from '../../../../src/core/board/model.ts';
import { instantiate, requireTemplate } from '../../../../src/core/board/templates.ts';
import {
  cambios,
  creatures,
  errores,
  step,
  tareasDeRepo,
} from '../../../../src/core/board/testing.ts';
import { boardSpeech } from '../../board-words.ts';
import { setLanguage } from '../../i18n/i18n.ts';
import type { ItemEvent, RelatedItem } from '../../types.ts';
import {
  approvalRefusal,
  backOf,
  boardItemOf,
  branchSaid,
  branchStrip,
  deliverLabel,
  fillControl,
  handRefusal,
  handRows,
  holdApproval,
  linksOf,
  localBehindSaid,
  ownStepOf,
  partsCount,
  railStep,
  roundNotes,
  selectOnFold,
  sheetLook,
  stepRounds,
  waitBlock,
  waitRows,
} from './board-item.ts';

const words = { done: 'Hecho', dip: (n: number) => `ronda ${n}` };
const agent = (name: string) => ({ kind: 'agent' as const, name });
const you = { kind: 'human' as const, name: 'tú' };
let id = 0;
const created = (state: string, at = '2026-01-01T00:00:00Z'): ItemEvent => ({
  id: ++id,
  type: 'created',
  actor: you,
  at,
  data: { state },
});
const moved = (from: string, to: string, by: ItemEvent['actor'], at: string): ItemEvent => ({
  id: ++id,
  type: 'transitioned',
  actor: by,
  at,
  data: { from, to },
});
const item = (state: string, events: ItemEvent[]) => ({
  state,
  createdAt: '2026-01-01T00:00:00Z',
  events,
});

describe('a reopened item: the page says why it came back from Done', () => {
  const reopenedEvents = (): ItemEvent[] => {
    const back = moved('done', 'simpl', agent('quill'), '2026-01-05T00:00:00Z');
    back.data = { from: 'done', to: 'simpl', reason: 'the PR conflicts', reopened: true };
    return [
      created('simpl'),
      moved('simpl', 'simpl__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('simpl__review', 'done', you, '2026-01-03T00:00:00Z'),
      back,
    ];
  };

  it('reads the reason and loops the route back from Done', () => {
    const on = boardItemOf(tareasDeRepo(), item('simpl', reopenedEvents()), {
      ...words,
      reopen: () => 'reabierto',
    });
    expect(on?.reopened).toEqual({
      why: 'the PR conflicts',
      by: 'quill',
      person: false,
      at: '2026-01-05T00:00:00Z',
    });
    expect(on?.round).toBe(2);
    expect(on?.route.dips).toEqual([{ at: (on?.route.steps.length ?? 0) - 1, label: 'reabierto' }]);
  });

  it('opens the new round with the reason, as a reopen', () => {
    const rounds = roundNotes(tareasDeRepo(), 'simpl', reopenedEvents());
    expect(rounds.at(-1)?.notes).toEqual([
      {
        kind: 'back',
        text: 'the PR conflicts',
        by: 'quill',
        person: false,
        at: '2026-01-05T00:00:00Z',
        reopened: true,
      },
    ]);
  });

  it('says nothing once the reopened step is handed off', () => {
    const events = [
      ...reopenedEvents(),
      moved('simpl', 'simpl__review', agent('quill'), '2026-01-06T00:00:00Z'),
    ];
    expect(boardItemOf(tareasDeRepo(), item('simpl__review', events), words)?.reopened).toBe(
      undefined,
    );
  });
});

describe('boardItemOf: the item page reads a published board through the step engine', () => {
  it('names no agent at a step any agent does, not the last agent that moved the item', () => {
    const events = [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z'),
    ];
    const on = boardItemOf(creatures(), item('sanimate', events), words);

    expect(on?.agent).toBeNull();
    expect(on?.round).toBe(1);
  });

  it('says no agent for a step any agent may take, nor during a review any agent does', () => {
    expect(boardItemOf(creatures(), item('sconcept', [created('sconcept')]), words)?.agent).toBe(
      null,
    );
    expect(
      boardItemOf(creatures(), item('sanimate__review', [created('sconcept')]), words)?.agent,
    ).toBeNull();
  });

  it('counts the round from a migration as the engine does: its question opens the next round', () => {
    const otea = { kind: 'human' as const, name: 'otea' };
    const reading = (data: Record<string, unknown>): ItemEvent => ({
      ...moved('needs_info', 'sconcept', otea, '2026-01-03T00:00:00Z'),
      data: { from: 'needs_info', to: 'sconcept', reason: 'migrate', ...data },
    });
    const before = [
      created('reported'),
      moved('reported', 'needs_info', you, '2026-01-02T00:00:00Z'),
    ];
    const asked = [...before, reading({ note: '¿Qué versión?' })];
    expect(boardItemOf(creatures(), item('sconcept', asked), words)?.round).toBe(2);
    const plain = [...before, reading({})];
    expect(boardItemOf(creatures(), item('sconcept', plain), words)?.round).toBe(1);
  });

  it('counts the round per step and draws the send-back where it came from', () => {
    const events = [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('sconcept__review', 'sconcept', you, '2026-01-03T00:00:00Z'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-04T00:00:00Z'),
      moved('sconcept__review', 'sanimate', you, '2026-01-05T00:00:00Z'),
    ];
    const atConcept = boardItemOf(creatures(), item('sconcept__review', events.slice(0, 4)), words);
    expect(atConcept?.round).toBe(2);
    expect(atConcept?.route.dips).toEqual([{ at: 1, label: 'ronda 1' }]);

    const atAnimate = boardItemOf(creatures(), item('sanimate', events), words);
    expect(atAnimate?.round).toBe(1);
    // The route's stops are the steps and the reviews on the other lane, never «· revisión» columns.
    expect(atAnimate?.route.words).toEqual(['Concepto', '', 'Animar', 'Pulir', 'Hecho']);
  });

  // R2 left: an item approved and then taken back by an agent (a conflict at landing) was not
  // sent back by the person, yet its route said «ronda 1 · devuelta hoy» under the step.
  it('words the loop of an approved item an agent took back as the bounce it is, not a send-back', () => {
    const events = [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z'),
      moved('sanimate', 'sconcept', agent('quill'), '2026-01-04T00:00:00Z'),
    ];
    const said = { ...words, bounce: (n: number) => `ronda ${n} · volvió` };
    const sentBack = boardItemOf(creatures(), item('sconcept', events), said);
    expect(sentBack?.route.dips.map((dip) => dip.label)).toEqual(['ronda 1']);
    const bounced = boardItemOf(creatures(), item('sconcept', events), said, {
      at: '2026-01-04T00:00:00Z',
    });
    expect(bounced?.route.dips.map((dip) => dip.label)).toEqual(['ronda 1 · volvió']);
  });

  // D-9b5288, D-0879d9 (s-real2): the round that only merges main into approved work was drawn as
  // «ronda 1 · devuelta hoy» and listed as «sent back and redone», though nothing was sent back.
  describe('a round that only merges main into approved work', () => {
    const merge = { since: 'a1b2c3d', tip: 'e4f5a6b', joined: 'c7d8e9f', files: ['README.md'] };
    const withData = (event: ItemEvent, data: Record<string, unknown>): ItemEvent => ({
      ...event,
      data: { ...event.data, ...data },
    });
    // Approved into the step after concept, an agent takes it back to merge what landed first and
    // hands it off again; the person approves the merge.
    const flow = (returned: Record<string, unknown>, handed: Record<string, unknown>) => [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z'),
      withData(moved('sanimate', 'sconcept', agent('quill'), '2026-01-04T00:00:00Z'), returned),
      withData(
        moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-05T00:00:00Z'),
        handed,
      ),
    ];
    const said = {
      ...words,
      bounce: (n: number) => `ronda ${n} · volvió`,
      merge: (n: number) => `ronda ${n} · fusión`,
    };

    it('says so on the route, whether it came back after others landed or merged a clash', () => {
      const labels = (events: ItemEvent[]) =>
        boardItemOf(creatures(), item('sconcept__review', events), said)?.route.dips.map(
          (dip) => dip.label,
        );
      expect(labels(flow({ waited: ['CAM-2'] }, {}))).toEqual(['ronda 1 · fusión']);
      expect(labels(flow({}, { merge }))).toEqual(['ronda 1 · fusión']);
    });

    it('leaves a plain send-back and a bounce on a clash as they were', () => {
      const labels = (events: ItemEvent[]) =>
        boardItemOf(creatures(), item('sconcept__review', events), said)?.route.dips.map(
          (dip) => dip.label,
        );
      expect(labels(flow({}, {}))).toEqual(['ronda 1']);
    });

    it('is no «sent back and redone» in Rondas, and its opening note says who merged', () => {
      const events = [
        ...flow({ waited: ['CAM-2'], reason: 'CAM-2 landed first' }, { merge }),
        moved('sconcept__review', 'sanimate', you, '2026-01-06T00:00:00Z'),
      ];
      const [concept] = stepRounds(creatures(), 'sanimate', events);
      expect(concept?.outcome).toEqual({ kind: 'merged' });
      expect(roundNotes(creatures(), 'sconcept', events)[1]?.notes[0]).toMatchObject({
        kind: 'back',
        merged: true,
        text: 'CAM-2 landed first',
      });
      // A send-back by the person into the same step is still one.
      const sent = [
        created('sconcept'),
        moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
        withData(moved('sconcept__review', 'sconcept', you, '2026-01-03T00:00:00Z'), {
          reason: 'no',
        }),
        moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-04T00:00:00Z'),
        moved('sconcept__review', 'sanimate', you, '2026-01-05T00:00:00Z'),
      ];
      expect(stepRounds(creatures(), 'sanimate', sent)[0]?.outcome).toEqual({ kind: 'reworked' });
    });
  });

  it('draws a closed item at Hecho, and leaves a state the board does not know to the preset', () => {
    expect(boardItemOf(creatures(), item('done', [created('sconcept')]), words)?.route.ci).toBe(4);
    expect(boardItemOf(creatures(), item('fixing', [created('fixing')]), words)).toBeNull();
  });
});

// ---- what the item page reads of a board item (PLAN §9.1): parts, links, waits, branch, rounds ----

const rel = (
  kind: RelatedItem['kind'],
  rid: string,
  o: Partial<RelatedItem> = {},
): RelatedItem => ({
  kind,
  id: rid,
  collection: 'Tareas de repo',
  type: 'item',
  title: rid,
  state: 'simpl',
  turn: 'agent',
  lease: null,
  ...o,
});
const names = (r: RelatedItem) => ({
  board: r.collection,
  ...(r.closes ? {} : { step: `@${r.state}` }),
});

describe('linksOf: an item’s parts and what holds it back, across boards', () => {
  it('reads them from the item’s relations when the server sends no board block', () => {
    const links = linksOf(
      {
        relations: [
          rel('child', 'RT-4'),
          rel('child', 'RT-5', { closes: 'done', state: 'done', turn: 'none' }),
          rel('blocked_by', 'ERR-2', { collection: 'Errores', state: 'striage' }),
          rel('blocks', 'TAR-3', { collection: 'Tareas' }),
          rel('parent', 'CAM-1', { collection: 'Cambios', state: 'sexec' }),
        ],
      },
      names,
    );
    expect(links.parts.map((p) => `${p.id}:${p.closed}:${p.step ?? ''}`)).toEqual([
      'RT-4:false:@simpl',
      'RT-5:true:',
    ]);
    expect(links.blockers.map((p) => `${p.id}@${p.board}`)).toEqual(['ERR-2@Errores']);
    expect(links.blocking.map((p) => p.id)).toEqual(['TAR-3']);
    expect(links.parent?.id).toBe('CAM-1');
    expect(partsCount(links.parts)).toEqual({ total: 2, open: 1, ended: 1 });
  });

  it('keeps what it implements, duplicates or relates to, in any board, by kind', () => {
    const links = linksOf(
      {
        relations: [
          rel('implements', 'IDE-1', { collection: 'Ideas' }),
          rel('implemented_by', 'TAR-4', { collection: 'Implementación' }),
          rel('implemented_by', 'TAR-5', { collection: 'Implementación' }),
          rel('relates', 'TEM-2', { collection: 'Temas' }),
          rel('blocks', 'TAR-3'),
        ],
        board: {
          parts: [],
          partsBoard: null,
          blockers: [],
          blocking: [{ id: 'TAR-3', board: 'Tareas', closed: false }],
          notes: [],
          gates: null,
          branch: null,
        },
      },
      names,
    );
    expect(links.related.map((g) => `${g.kind}:${g.items.map((x) => x.id).join(',')}`)).toEqual([
      'implements:IDE-1',
      'implemented_by:TAR-4,TAR-5',
      'relates:TEM-2',
    ]);
    expect(links.related[0]?.items[0]).toMatchObject({ board: 'Ideas', title: 'IDE-1' });
  });

  it('takes the board block’s lists when the server sends them, keeping titles from relations', () => {
    const links = linksOf(
      {
        relations: [rel('child', 'RT-4', { title: 'API' })],
        board: {
          parts: [{ id: 'RT-4', board: 'Tareas de repo', step: 'Implementar', closed: false }],
          partsBoard: 'Tareas de repo',
          blockers: [],
          blocking: [],
          notes: [],
          gates: null,
          branch: null,
        },
      },
      names,
    );
    expect(links.parts).toMatchObject([{ id: 'RT-4', step: 'Implementar', title: 'API' }]);
    expect(links.partsBoard).toBe('Tareas de repo');
  });
});

describe('waitRows: what a step waits for', () => {
  it('lists the open parts and blockers of a step that waits for them', () => {
    const links = linksOf(
      { relations: [rel('child', 'B-2'), rel('blocked_by', 'T-1', { collection: 'Tareas' })] },
      names,
    );
    const rows = waitRows(errores(), 'sfix', links);
    expect(rows.map((r) => `${r.kind}:${r.open.map((x) => x.id).join(',')}/${r.total}`)).toEqual([
      'parts:B-2/1',
      'blockers:T-1/1',
    ]);
    expect(waitRows(errores(), 'striage', links)).toEqual([]);
  });

  it('says nothing of parts on an item that has none: there is nothing to wait for (IDEA3-7)', () => {
    const links = linksOf({ relations: [] }, names);
    expect(waitRows(errores(), 'sfix', links).map((r) => r.kind)).toEqual(['blockers']);
  });
});

describe('branchStrip: the protected branch where the item stands', () => {
  const def = tareasDeRepo();
  const fields = { fbranch: 'feat/nube', frepo: 'api' };

  it('may be pushed while a push step is done, is frozen in its review, merged at Hecho', () => {
    expect(branchStrip(def, 'simpl', fields)).toEqual({
      tone: 'ok',
      key: 'push',
      value: 'feat/nube',
      repo: 'api',
      step: 'Implementar',
    });
    expect(branchStrip(def, 'simpl__review', fields)?.key).toBe('frozen');
    expect(branchStrip(def, 'done', fields)?.key).toBe('merge');
    expect(branchStrip(def, 'done', fields, { merged: true })?.key).toBe('merged');
    expect(branchStrip(def, 'dropped', fields)?.key).toBe('closed');
    expect(branchStrip(def, 'sprop', fields)).toMatchObject({
      tone: 'off',
      key: 'noPush',
      step: 'Propuesta',
    });
  });

  it('is merged in the land step once Done, on a board that has one, never «may be merged»', () => {
    const landing = tareasDeRepo();
    landing.steps.push(step('sland', 'Integrar', { reviewer: 'none' }));
    expect(branchStrip(landing, 'done', fields)).toMatchObject({
      tone: 'ok',
      key: 'landed',
      step: 'Integrar',
    });
    expect(branchStrip(landing, 'done', fields, { merged: true })?.key).toBe('merged');
    // While it is landed: an agent merges it into the base and pushes, said on the page (P5-15).
    const guard = landing.parts.fbranch?.guard;
    if (guard) guard.base = 'main';
    expect(branchStrip(landing, 'sland', fields)).toMatchObject({
      tone: 'ok',
      key: 'landing',
      base: 'main',
    });
    expect(branchStrip(landing, 'sland', fields)?.own).toBeUndefined();
    // Its branch the base itself (a main-only board): pushed, never merged (P2S-R3-2).
    const onMain = { ...fields, fbranch: 'main' };
    expect(branchStrip(landing, 'sland', onMain)).toMatchObject({ key: 'landing', own: true });
    // With no remote there is nothing to push: it says the folder is brought up to date (field
    // study 5, V7), never «sube main al remoto».
    const local = branchStrip(landing, 'sland', onMain, { local: true });
    expect(local).toMatchObject({ key: 'landing', own: true, local: true });
    if (!local) throw new Error('no strip');
    expect(branchSaid(local)).toBe('an agent brings main up to date in your folder next');
    setLanguage('es');
    expect(branchSaid(local)).toBe('un agente pone main al día en tu carpeta a continuación');
    expect(branchSaid(local)).not.toMatch(/remoto/);
    setLanguage('en');
  });

  it('says a Done item landed in a repo with no remote is not in the person’s main yet', () => {
    const behind = {
      base: 'main',
      remote: '',
      target: 'abc1234',
      local: true as const,
      behind: 1,
      checkout: 'D:/proyecto',
      state: 'ready' as const,
    };
    expect(localBehindSaid(behind)).toContain('no remote');
    expect(localBehindSaid(behind)).toContain('otea land sync');
    setLanguage('es');
    expect(localBehindSaid(behind)).toContain('no hay remoto');
    expect(localBehindSaid(behind)).not.toContain('git pull');
    setLanguage('en');
  });

  it('is nothing on a board without a protected branch, or before the branch is named', () => {
    expect(branchStrip(creatures(), 'sconcept', fields)).toBeNull();
    expect(branchStrip(def, 'simpl', {})).toBeNull();
  });
});

const said = (e: ItemEvent, reason: string): ItemEvent => ({ ...e, data: { ...e.data, reason } });

describe('roundNotes: each round of the step with its notes', () => {
  const by = agent('mender');
  const handed = (e: ItemEvent, note: string): ItemEvent => ({ ...e, data: { ...e.data, note } });
  it('keeps the handoff note and the person’s send-back reason, round by round', () => {
    const events: ItemEvent[] = [
      created('sfix'),
      handed(moved('sfix', 'sfix__review', by, '2026-01-02T00:00:00Z'), 'Probé el muelle.'),
      said(moved('sfix__review', 'sfix', you, '2026-01-03T00:00:00Z'), 'Sigue cayendo.'),
    ];
    expect(roundNotes(errores(), 'sfix', events)).toEqual([
      {
        round: 1,
        notes: [
          {
            kind: 'handoff',
            text: 'Probé el muelle.',
            by: 'mender',
            person: false,
            at: '2026-01-02T00:00:00Z',
          },
        ],
        doer: { name: 'mender' },
      },
      {
        round: 2,
        notes: [
          {
            kind: 'back',
            text: 'Sigue cayendo.',
            by: 'tú',
            person: true,
            at: '2026-01-03T00:00:00Z',
          },
        ],
      },
    ]);
  });

  // P1-F1: a send-back an agent relayed is not the person's own, so «lo devolviste» never shows.
  it('names the agent that relayed a send-back and does not call it the person’s', () => {
    const relayed = said(
      moved('sfix__review', 'sfix', you, '2026-01-03T00:00:00Z'),
      'Sigue cayendo.',
    );
    relayed.data = { ...relayed.data, via: 'orch-a', quote: 'devuélvelo' };
    const events: ItemEvent[] = [
      created('sfix'),
      moved('sfix', 'sfix__review', by, '2026-01-02T00:00:00Z'),
      relayed,
    ];
    expect(roundNotes(errores(), 'sfix', events)[1]?.notes).toEqual([
      {
        kind: 'back',
        text: 'Sigue cayendo.',
        by: 'orch-a',
        person: false,
        relayedBy: 'orch-a',
        at: '2026-01-03T00:00:00Z',
      },
    ]);
  });

  it('names who did each round with the profile it handed off with (agents mock §5)', () => {
    const opus = { harness: 'claude-code', model: 'opus', effort: 'high', family: 'opus' };
    const gpt = { harness: 'codex', model: 'gpt-5.5', effort: 'high', family: 'gpt-5' };
    const events: ItemEvent[] = [
      created('sfix'),
      { ...moved('sfix', 'sfix__review', agent('codex-b'), '2026-01-02T00:00:00Z'), profile: gpt },
      said(moved('sfix__review', 'sfix', you, '2026-01-03T00:00:00Z'), 'Falta la fecha.'),
      { ...moved('sfix', 'sfix__review', by, '2026-01-04T00:00:00Z'), profile: opus },
    ];
    expect(roundNotes(errores(), 'sfix', events).map((r) => [r.round, r.doer])).toEqual([
      [1, { name: 'codex-b', profile: gpt }],
      [2, { name: 'mender', profile: opus }],
    ]);
  });

  it('names the agent that did the round, never the agent that reviewed it', () => {
    const def = creatures();
    const events: ItemEvent[] = [
      created('sanimate'),
      moved('sanimate', 'sanimate__review', agent('impl'), '2026-01-02T00:00:00Z'),
      moved('sanimate__review', 'spolish', agent('rev-1'), '2026-01-03T00:00:00Z'),
    ];
    expect(roundNotes(def, 'sanimate', events).map((r) => r.doer?.name)).toEqual(['impl']);
  });

  it('starts the next round of Completar with the question Devolver brought', () => {
    const events: ItemEvent[] = [
      created('sfill'),
      said(moved('sfill', 'striage', agent('kiln'), '2026-01-01T12:00:00Z'), 'Completo.'),
      said(moved('striage', 'sfill', you, '2026-01-02T00:00:00Z'), '¿En qué versión?'),
    ];
    expect(roundNotes(errores(), 'sfill', events).at(-1)).toEqual({
      round: 2,
      notes: [
        {
          kind: 'back',
          text: '¿En qué versión?',
          by: 'tú',
          person: true,
          at: '2026-01-02T00:00:00Z',
        },
      ],
    });
  });

  it('counts rounds as the engine does: an item that skipped Completar starts it at round 1', () => {
    const events: ItemEvent[] = [
      created('striage'),
      said(moved('striage', 'sfill', you, '2026-01-02T00:00:00Z'), '¿En qué versión?'),
    ];
    expect(roundNotes(errores(), 'sfill', events)).toEqual([
      {
        round: 1,
        notes: [
          {
            kind: 'back',
            text: '¿En qué versión?',
            by: 'tú',
            person: true,
            at: '2026-01-02T00:00:00Z',
          },
        ],
      },
    ]);
  });

  it('opens no round when the person moves it on, forward, with a word', () => {
    const events: ItemEvent[] = [
      created('sfill'),
      said(moved('sfill', 'striage', agent('kiln'), '2026-01-02T00:00:00Z'), 'Completo.'),
      said(moved('striage', 'sfix', you, '2026-01-03T00:00:00Z'), 'Adelante.'),
    ];
    expect(roundNotes(errores(), 'sfix', events)).toEqual([{ round: 1, notes: [] }]);
  });

  it('reads the question a migration carried as the next round’s note, never the word migrate', () => {
    const otea = { kind: 'human' as const, name: 'otea' };
    const migrate = (data: Record<string, unknown>): ItemEvent => ({
      ...moved('needs_info', 'sfill', otea, '2026-01-03T00:00:00Z'),
      data: { from: 'needs_info', to: 'sfill', reason: 'migrate', ...data },
    });
    expect(
      roundNotes(errores(), 'sfill', [created('sfill'), migrate({ note: '¿Qué versión?' })]),
    ).toEqual([
      { round: 1, notes: [] },
      {
        round: 2,
        notes: [
          { kind: 'back', text: '¿Qué versión?', by: '', person: true, at: '2026-01-03T00:00:00Z' },
        ],
      },
    ]);
    // A reading without a question starts the step afresh, as the engine reads it.
    expect(roundNotes(errores(), 'sfill', [created('sfill'), migrate({})])).toEqual([
      { round: 1, notes: [] },
    ]);
  });

  it('starts at the migration as the engine does: the preset states before it open no round', () => {
    const otea = { kind: 'human' as const, name: 'otea' };
    const at = '2026-01-03T00:00:00Z';
    const events: ItemEvent[] = [
      created('reported'),
      said(moved('reported', 'needs_info', you, '2026-01-02T00:00:00Z'), '¿Qué versión?'),
      {
        ...moved('needs_info', 'sfill', otea, at),
        data: { from: 'needs_info', to: 'sfill', reason: 'migrate', note: '¿Qué versión?' },
      },
    ];
    expect(roundNotes(errores(), 'sfill', events)).toEqual([
      { round: 1, notes: [] },
      {
        round: 2,
        notes: [{ kind: 'back', text: '¿Qué versión?', by: '', person: true, at }],
      },
    ]);
  });

  it('is one round with nothing to say on a first round', () => {
    expect(roundNotes(errores(), 'sfix', [created('sfix')])).toEqual([{ round: 1, notes: [] }]);
  });

  it('opens no round for a send-back the person took back with Deshacer', () => {
    const back = said(moved('sfix__review', 'sfix', you, '2026-01-03T00:00:00Z'), 'Sigue.');
    const undo = {
      ...moved('sfix', 'sfix__review', you, '2026-01-03T00:00:05Z'),
      data: { from: 'sfix', to: 'sfix__review', undoes: back.id },
    };
    const events: ItemEvent[] = [
      created('sfix'),
      handed(moved('sfix', 'sfix__review', by, '2026-01-02T00:00:00Z'), 'Probé el muelle.'),
      back,
      undo,
    ];
    expect(roundNotes(errores(), 'sfix', events).map(({ round }) => round)).toEqual([1]);
  });
});

// p4 leftover: the route strip of the person's own to-do drew Pendientes' whole line, «Tu parte →
// Hacerlo → Hecho», though «Tu parte» leads it straight to Hecho while «Lo hago yo» is sí.
describe('boardItemOf: the route a step that leads elsewhere sends the item', () => {
  const def = instantiate(requireTemplate('todos'), 'es', {}, sequenceIds());
  const own = def.steps[0]?.id ?? '';
  const mine = Object.values(def.parts).find(({ name }) => name === 'Lo hago yo')?.id ?? '';
  const todo = (state: string, yes: boolean) => ({
    ...item(state, [created(own)]),
    fields: { [mine]: yes ? 'yes' : 'no' },
  });

  it('draws the way the lead takes it, leaving out the steps it skips', () => {
    const on = boardItemOf(def, todo(own, true), words);
    expect(on?.route.words).toEqual(['Tu parte', 'Hecho']);
    expect(on?.route.ci).toBe(0);
  });

  it('draws the whole line while the lead does not hold', () => {
    expect(boardItemOf(def, todo(own, false), words)?.route.words).toContain('Hacerlo');
  });

  it('draws the way it took once it is done', () => {
    const done = {
      ...todo('done', true),
      events: [created(own), moved(own, 'done', you, '2026-01-02T00:00:00Z')],
    };
    expect(boardItemOf(def, done, words)?.route.words).toEqual(['Tu parte', 'Hecho']);
  });
});

describe('boardItemOf and Deshacer', () => {
  it('keeps the next step in its first round after an approval taken back and given again', () => {
    const approved = moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z');
    const events: ItemEvent[] = [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      approved,
      {
        ...moved('sanimate', 'sconcept__review', you, '2026-01-03T00:00:05Z'),
        data: { from: 'sanimate', to: 'sconcept__review', undoes: approved.id },
      },
      moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:09Z'),
    ];
    expect(boardItemOf(creatures(), item('sanimate', events), words)?.round).toBe(1);
  });
});

describe('approvalRefusal: Aprobar refused in words when a wait no longer holds', () => {
  it('names the open parts, or what holds it back', () => {
    setLanguage('es');
    const stepOf: Record<string, string> = { simpl: 'Implementar', sprop: 'Propuesta' };
    const links = linksOf(
      {
        relations: [
          rel('child', 'RT-4', { state: 'simpl' }),
          rel('child', 'RT-5', { state: 'sprop' }),
          rel('blocked_by', 'ERR-2', { collection: 'Errores', state: 'striage' }),
        ],
      },
      (r) => ({ board: r.collection, step: stepOf[r.state] ?? 'Triar' }),
    );
    expect(approvalRefusal('CAM-1', waitRows(cambios(), 'sexec', links))).toBe(
      'No se aprobó CAM-1: RT-4 («Implementar») y RT-5 («Propuesta») siguen sin terminar.',
    );
    expect(approvalRefusal('ERR-1', waitRows(errores(), 'sfix', { ...links, parts: [] }))).toBe(
      'No se aprobó ERR-1: ERR-2 (en «Errores», paso «Triar») lo frena y sigue sin terminar.',
    );
    expect(approvalRefusal('ERR-1', [])).toBeNull();
    setLanguage('en');
  });

  it('says a Done blocker whose branch is not merged yet still holds it', () => {
    setLanguage('es');
    const item = {
      relations: [rel('blocked_by', 'ENT-1', { collection: 'Entregas', state: 'done' })],
      board: {
        parts: [],
        blockers: [{ id: 'ENT-1', board: 'Entregas', closed: false, unmerged: true as const }],
        blocking: [],
      },
    } as unknown as Parameters<typeof linksOf>[0];
    const links = linksOf(item, (r) => ({ board: r.collection }));
    expect(links.blockers[0]).toMatchObject({ closed: false, step: 'Hecho, falta integrar' });
    const rows = waitRows(errores(), 'sfix', links);
    expect(approvalRefusal('ENT-2', rows)).toBe(
      'No se aprobó ENT-2: ENT-1 (en «Entregas») lo frena y aún no se integró: apruébalo cuando esté integrado.',
    );
    expect(waitBlock(rows)).toBe('espera a ENT-1, que lo frena');
    setLanguage('en');
  });

  it('says a parent’s Done parts not merged yet still hold it', () => {
    setLanguage('es');
    const item = {
      relations: [rel('child', 'ENT-1', { collection: 'Entregas', state: 'done' })],
      board: {
        parts: [{ id: 'ENT-1', board: 'Entregas', closed: false, unmerged: true as const }],
        blockers: [],
        blocking: [],
      },
    } as unknown as Parameters<typeof linksOf>[0];
    const links = linksOf(item, (r) => ({ board: r.collection }));
    expect(approvalRefusal('TRA-1', waitRows(cambios(), 'sexec', links))).toBe(
      'No se aprobó TRA-1: ENT-1 aún no se integró.',
    );
    setLanguage('en');
  });
});

describe('holdApproval: Aprobar held while a part is open', () => {
  it('turns Aprobar off with what it waits for, and leaves other moves alone', () => {
    setLanguage('es');
    const links = linksOf({ relations: [rel('child', 'RT-4', { state: 'simpl' })] }, (r) => ({
      board: r.collection,
      step: 'Implementar',
    }));
    const rows = waitRows(cambios(), 'sexec', links);
    const approve = { kind: 'approve', label: 'Aprobar' };
    expect(holdApproval(approve, rows)).toEqual({
      ...approve,
      blocked: 'espera a que termine RT-4',
    });
    expect(holdApproval({ kind: 'sendback', label: 'Devolver' }, rows)).toEqual({
      kind: 'sendback',
      label: 'Devolver',
    });
    expect(holdApproval(approve, [])).toEqual(approve);
    setLanguage('en');
  });
});

describe('waitBlock: Entregar held while what the step waits for is open', () => {
  it('names the open parts, else what holds it back, else nothing', () => {
    setLanguage('es');
    const links = linksOf(
      {
        relations: [
          rel('child', 'RT-4', { state: 'simpl' }),
          rel('blocked_by', 'ERR-2', { collection: 'Errores', state: 'striage' }),
          rel('blocked_by', 'ERR-3', { collection: 'Errores', state: 'striage' }),
        ],
      },
      (r) => ({ board: r.collection, step: 'Triar' }),
    );
    expect(waitBlock(waitRows(cambios(), 'sexec', links))).toBe('espera a que termine RT-4');
    expect(waitBlock(waitRows(errores(), 'sfix', { ...links, parts: [] }))).toBe(
      'espera a ERR-2 y ERR-3, que lo frenan',
    );
    expect(waitBlock(waitRows(errores(), 'sfix', { ...links, parts: [], blockers: [] }))).toBe(
      undefined,
    );
    setLanguage('en');
    expect(waitBlock(waitRows(errores(), 'sfix', { ...links, parts: [] }))).toBe(
      'waits for ERR-2 and ERR-3, which hold it back',
    );
  });
});

describe('sheetLook: open parts are a wait at the handoff, not a look', () => {
  it('reads an item on a board with open parts as queued; every other look stays', () => {
    expect(sheetLook('waiting', true)).toBe('queued');
    expect(sheetLook('working', true)).toBe('working');
    expect(sheetLook('waiting', false)).toBe('waiting');
  });
});

describe('backOf: where a way back lands, in the rounds of the engine', () => {
  it('names the round of the step it starts, and no agent', () => {
    const skipped = item('striage', [created('striage')]);
    expect(backOf(errores(), skipped, 'sfill')).toEqual({ agent: null, round: 1 });
    const twice = item('sfix', [
      created('striage'),
      moved('striage', 'sfix', you, '2026-01-02T00:00:00Z'),
      moved('sfix', 'striage', agent('mender'), '2026-01-03T00:00:00Z'),
      moved('striage', 'sfix', you, '2026-01-04T00:00:00Z'),
    ]);
    expect(backOf(errores(), twice, 'striage')).toEqual({ agent: null, round: 3 });
    expect(backOf(errores(), twice, 'sfix')).toEqual({ agent: null, round: 3 });
  });

  // An item that left Rama empty is told nothing of merging (P5-R2-5, P4-R2-4).
  it('says the land step merges and pushes only for an item that names its branch', () => {
    const def = tareasDeRepo();
    const branch = Object.values(def.parts).find((part) => part.guard);
    if (!branch?.guard) throw new Error('no protected branch');
    branch.guard.base = 'main';
    def.steps.push(step('sland', 'Integrar', { reviewer: 'none' }));
    const review = item('simpl__review', [created('simpl')]);
    expect(backOf(def, { ...review, fields: { [branch.id]: 'feat/x' } }, 'sland')).toMatchObject({
      lands: 'main',
      landStep: 'Integrar',
    });
    expect(backOf(def, { ...review, fields: { [branch.id]: '' } }, 'sland').lands).toBeUndefined();
    // P5-R3-14: whether the land step pushes, for the approve hint to say so.
    expect(
      backOf(def, { ...review, fields: { [branch.id]: 'feat/x' } }, 'sland').pushes,
    ).toBeUndefined();
    branch.guard.push = [...branch.guard.push, 'sland'];
    expect(backOf(def, { ...review, fields: { [branch.id]: 'feat/x' } }, 'sland').pushes).toBe(
      true,
    );
    // Its branch the base itself (a main-only board): pushed, never merged (P2S-R3-2).
    expect(backOf(def, { ...review, fields: { [branch.id]: 'main' } }, 'sland')).toMatchObject({
      lands: 'main',
      own: true,
    });
    expect(
      backOf(def, { ...review, fields: { [branch.id]: 'feat/x' } }, 'sland').own,
    ).toBeUndefined();
    const plain = tareasDeRepo();
    expect(backOf(plain, { ...review, fields: {} }, 'done').unmerged).toBeUndefined();
    expect(backOf(plain, { ...review, fields: { [branch.id]: 'feat/x' } }, 'done').unmerged).toBe(
      true,
    );
  });

  it('names the branch the last handoff into review left never pushed (P7-8)', () => {
    const handed = moved('sfix', 'sfix__review', agent('mender'), '2026-01-02T00:00:00Z');
    const tip = { branch: 'fix/1', commit: 'a', tree: 'b', pushed: false };
    const unpushed = item('sfix__review', [
      created('sfix'),
      { ...handed, data: { ...handed.data, tip } },
    ]);
    expect(backOf(errores(), unpushed, 'sland')).toMatchObject({ unpushed: 'fix/1' });
    const pushed = item('sfix__review', [
      created('sfix'),
      { ...handed, data: { ...handed.data, tip: { ...tip, pushed: undefined } } },
    ]);
    expect(backOf(errores(), pushed, 'sland').unpushed).toBeUndefined();
  });

  it('says the last handoff into review brought no code change (P2S-R3-3)', () => {
    const handed = moved('sfix', 'sfix__review', agent('mender'), '2026-01-02T00:00:00Z');
    const tip = { branch: 'main', commit: 'a', tree: 'b', unchanged: true };
    const none = item('sfix__review', [
      created('sfix'),
      { ...handed, data: { ...handed.data, tip } },
    ]);
    expect(backOf(errores(), none, 'sland')).toMatchObject({ unchanged: true });
    const some = item('sfix__review', [
      created('sfix'),
      { ...handed, data: { ...handed.data, tip: { ...tip, unchanged: undefined } } },
    ]);
    expect(backOf(errores(), some, 'sland').unchanged).toBeUndefined();
  });
});

describe('the person’s own step', () => {
  it('is a step you do while it is being done, not a review or an agent’s step', () => {
    const def = tareasDeRepo();
    expect(ownStepOf(def, { state: 'sprop', turn: 'human' })?.name).toBe('Propuesta');
    expect(ownStepOf(def, { state: 'simpl', turn: 'agent' })).toBeUndefined();
    expect(ownStepOf(def, { state: 'simpl__review', turn: 'human' })).toBeUndefined();
    expect(ownStepOf(def, { state: 'done', turn: 'none' })).toBeUndefined();
  });

  it('lists what it hands, fillable when a field, and refuses Entregar in the page’s words', () => {
    setLanguage('es');
    const def = tareasDeRepo();
    const step = ownStepOf(def, { state: 'sprop', turn: 'human' });
    if (!step) throw new Error('no own step');
    const missing = [{ ref: 'fwhat', name: 'Qué propone', reason: 'missing' }];
    expect(handRows(def, step, missing)).toEqual([
      expect.objectContaining({ ref: 'fwhat', name: 'Qué propone', ok: false, required: true }),
    ]);
    expect(handRows(def, step, missing)[0]?.part?.kind).toBe('long');
    expect(handRefusal('TAR2-1', missing)).toBe('No se entregó TAR2-1. Falta: «Qué propone».');
    expect(handRefusal('TAR2-1', [])).toBeNull();
    expect(handRows(def, step, [])[0]?.ok).toBe(true);
  });

  // The picker Rellenar opens: a Spanish desk on an English board offers Low … Critical and Yes, No.
  it('offers the levels and yes or no of an English board in English on a Spanish desk', () => {
    setLanguage('es');
    const def = { ...tareasDeRepo(), lang: 'en', title: 'Title' };
    def.parts.flevel = { id: 'flevel', name: 'Risk', kind: 'level', hint: '', options: [] };
    def.parts.fyes = { id: 'fyes', name: 'Safe', kind: 'yesno', hint: '', options: [] };
    const step = ownStepOf(def, { state: 'sprop', turn: 'human' });
    if (!step) throw new Error('no own step');
    step.hand.push({ ref: 'flevel', req: 'always', fresh: false });
    step.hand.push({ ref: 'fyes', req: 'always', fresh: false });
    const names = (ref: string) => {
      const control = handRows(def, step, []).find((row) => row.ref === ref)?.control;
      return control && 'choices' in control ? control.choices.map(({ name }) => name) : [];
    };
    expect(names('flevel')).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(names('fyes')).toEqual(['Yes', 'No']);
  });

  it('marks an optional deliverable done only once it holds something', () => {
    setLanguage('es');
    const def = tareasDeRepo();
    const step = def.steps.find((s) => s.id === 'simpl');
    if (!step) throw new Error('no Implementar');
    step.hand.push({ ref: 'fwhat', req: 'no', fresh: false });
    const row = (filled?: (ref: string) => boolean) =>
      handRows(def, step, [], {}, filled).find(({ ref }) => ref === 'fwhat');
    expect(row()).toMatchObject({ ok: false, required: false });
    expect(row(() => false)).toMatchObject({ ok: false, required: false });
    expect(row((ref) => ref === 'fwhat')).toMatchObject({ ok: true, required: false });
  });

  it('names the hand-off by the step itself, whatever it hands', () => {
    setLanguage('es');
    const triage = ownStepOf(errores(), { state: 'striage', turn: 'human' });
    if (!triage) throw new Error('no own step');
    expect(deliverLabel(triage)).toBe('Triar');
    const def = tareasDeRepo();
    const own = ownStepOf(def, { state: 'sprop', turn: 'human' });
    if (!own) throw new Error('no own step');
    expect(deliverLabel({ ...own, name: ' ' })).toBe('Entregar');
    const empty = {
      ...own,
      name: 'Aprobar el merge',
      hand: [],
      note: { ...own.note, req: 'no' as const },
    };
    expect(deliverLabel(empty)).toBe('Aprobar el merge');
  });

  // P4-R3-1: the person's own to-do («Lo hago yo»: sí) leads to Hecho, and its button says so.
  it('names the hand-off Marcar hecho while the step leads the item to Hecho', () => {
    setLanguage('es');
    const def = errores();
    const triage = ownStepOf(def, { state: 'striage', turn: 'human' });
    if (!triage) throw new Error('no own step');
    def.parts.fmine = { id: 'fmine', name: 'Lo hago yo', kind: 'yesno', hint: '', options: [] };
    const own = {
      ...triage,
      ways: ['done'],
      lead: { to: 'done', when: { part: 'fmine', value: 'yes' } },
    };
    expect(deliverLabel(own, { def, fields: { fmine: 'yes' } })).toBe('Marcar hecho');
    expect(deliverLabel(own, { def, fields: { fmine: 'no' } })).toBe('Triar');
  });

  it('fills a level, a yes or no and a choice from their values, and types numbers and dates', () => {
    setLanguage('es');
    const part = (kind: Part['kind'], options: Part['options'] = []): Part => ({
      id: 'fx',
      name: 'X',
      kind,
      hint: '',
      options,
    });
    const spanish = boardSpeech({ lang: 'es', title: 'Título' });
    expect(fillControl(part('level'), spanish)).toEqual({
      choices: [
        { id: 'low', name: 'Baja' },
        { id: 'medium', name: 'Media' },
        { id: 'high', name: 'Alta' },
        { id: 'critical', name: 'Crítica' },
      ],
    });
    expect(fillControl(part('yesno'), spanish)).toEqual({
      choices: [
        { id: 'yes', name: 'Sí' },
        { id: 'no', name: 'No' },
      ],
    });
    expect(fillControl(part('choice', [{ id: 'c1', name: 'Bug' }]), spanish)).toEqual({
      choices: [{ id: 'c1', name: 'Bug' }],
    });
    expect(fillControl(part('number'), spanish)).toEqual({ input: 'number' });
    expect(fillControl(part('date'), spanish)).toEqual({ input: 'date' });
    expect(fillControl(part('url'), spanish)).toEqual({ input: 'url' });
    expect(fillControl(part('long'), spanish)).toEqual({ input: 'long' });
    expect(fillControl(part('text'), spanish)).toEqual({ input: 'text' });
  });

  // A Spanish desk on an English board: Rellenar offers the words the agent reads (Low, Yes), not
  // the screen's (Baja, Sí).
  it('fills a level and a yes or no in the board’s language, not the screen’s', () => {
    setLanguage('es');
    const def = { ...tareasDeRepo(), lang: 'en', title: 'Title' };
    const part = (kind: Part['kind']): Part => ({
      id: 'fx',
      name: 'X',
      kind,
      hint: '',
      options: [],
    });
    const english = boardSpeech(def);
    expect(fillControl(part('level'), english)).toEqual({
      choices: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'critical', name: 'Critical' },
      ],
    });
    expect(fillControl(part('yesno'), english)).toEqual({
      choices: [
        { id: 'yes', name: 'Yes' },
        { id: 'no', name: 'No' },
      ],
    });
  });

  it('leaves out a deliverable asked only when a field holds a value it does not hold', () => {
    setLanguage('es');
    const def = tareasDeRepo();
    def.parts.fkind = {
      id: 'fkind',
      name: 'Tipo',
      kind: 'choice',
      hint: '',
      options: [
        { id: 'cui', name: 'Interfaz' },
        { id: 'cbug', name: 'Error' },
      ],
    };
    const step = def.steps.find((s) => s.id === 'simpl');
    if (!step) throw new Error('no Implementar');
    step.hand.push({
      ref: 'fwhat',
      req: 'when',
      when: { part: 'fkind', value: 'cui' },
      fresh: false,
    });
    const refs = (fields: Record<string, string>) =>
      handRows(def, step, [], fields).map(({ ref }) => ref);
    expect(refs({ fkind: 'cbug' })).toEqual(['ecode']);
    expect(refs({ fkind: 'cui' })).toEqual(['ecode', 'fwhat']);
  });
});

describe('stepRounds: the item’s whole history, grouped by step', () => {
  const mender = agent('mender');
  const kiln = agent('kiln');
  const note = (e: ItemEvent, text: string): ItemEvent => ({
    ...e,
    data: { ...e.data, note: text },
  });
  // Completar → Triar (sent back to Completar once) → Triar → Arreglar, sent back once in review.
  const crossed = (): ItemEvent[] => [
    created('sfill'),
    note(moved('sfill', 'striage', kiln, '2026-01-02T00:00:00Z'), 'Completo.'),
    said(moved('striage', 'sfill', you, '2026-01-03T00:00:00Z'), '¿En qué versión?'),
    note(moved('sfill', 'striage', kiln, '2026-01-04T00:00:00Z'), 'La 1.2.'),
    moved('striage', 'sfix', you, '2026-01-05T00:00:00Z'),
    note(moved('sfix', 'sfix__review', mender, '2026-01-06T00:00:00Z'), 'Probé el muelle.'),
    said(moved('sfix__review', 'sfix', you, '2026-01-07T00:00:00Z'), 'Sigue cayendo.'),
    note(moved('sfix', 'sfix__review', mender, '2026-01-08T00:00:00Z'), 'Ya no cae.'),
  ];
  const brief = (groups: ReturnType<typeof stepRounds>) =>
    groups.map(({ step, name, rounds, outcome, current, open }) => ({
      step,
      name,
      count: rounds.length,
      outcome,
      current,
      open,
    }));

  it('lists every step it went through in order, the current one open, earlier ones folded', () => {
    expect(brief(stepRounds(errores(), 'sfix__review', crossed()))).toEqual([
      {
        step: 'sfill',
        name: 'Completar',
        count: 2,
        outcome: { kind: 'reworked' },
        current: false,
        open: false,
      },
      {
        step: 'striage',
        name: 'Triar',
        count: 2,
        outcome: { kind: 'handed' },
        current: false,
        open: false,
      },
      { step: 'sfix', name: 'Arreglar', count: 2, outcome: undefined, current: true, open: true },
    ]);
  });

  it('gives each step its rounds as roundNotes counts them, never counted again', () => {
    const events = crossed();
    for (const group of stepRounds(errores(), 'sfix__review', events))
      expect(group.rounds).toEqual(roundNotes(errores(), group.step, events));
  });

  it('reads an approval from a review as approved, and a way back as sent back to that step', () => {
    const approved = [
      created('sconcept'),
      moved('sconcept', 'sconcept__review', agent('quill'), '2026-01-02T00:00:00Z'),
      moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z'),
    ];
    expect(stepRounds(creatures(), 'sanimate', approved)[0]?.outcome).toEqual({ kind: 'approved' });
    // An approval an agent relayed is its word that the person gave it: it reads as relayed.
    const relayed = moved('sconcept__review', 'sanimate', you, '2026-01-03T00:00:00Z');
    relayed.data = { ...relayed.data, via: 'orch-a', quote: 'yes go' };
    expect(
      stepRounds(creatures(), 'sanimate', [...approved.slice(0, 2), relayed])[0]?.outcome,
    ).toEqual({ kind: 'relayed' });
    const back = [
      ...crossed(),
      said(moved('sfix__review', 'striage', you, '2026-01-09T00:00:00Z'), 'Otra categoría.'),
    ];
    // The step it is on comes last: it was entered last.
    expect(brief(stepRounds(errores(), 'striage', back))).toEqual([
      {
        step: 'sfill',
        name: 'Completar',
        count: 2,
        outcome: { kind: 'reworked' },
        current: false,
        open: false,
      },
      {
        step: 'sfix',
        name: 'Arreglar',
        count: 2,
        outcome: { kind: 'back', to: 'Triar' },
        current: false,
        open: false,
      },
      { step: 'striage', name: 'Triar', count: 3, outcome: undefined, current: true, open: true },
    ]);
  });

  it('folds every step of a closed item but its last, which says how it closed', () => {
    const dropped = [
      ...crossed(),
      said(moved('sfix__review', 'dropped__duplicate', you, '2026-01-09T00:00:00Z'), 'Repetido.'),
    ];
    expect(brief(stepRounds(errores(), 'dropped__duplicate', dropped))).toEqual([
      {
        step: 'sfill',
        name: 'Completar',
        count: 2,
        outcome: { kind: 'reworked' },
        current: false,
        open: false,
      },
      {
        step: 'striage',
        name: 'Triar',
        count: 2,
        outcome: { kind: 'handed' },
        current: false,
        open: false,
      },
      {
        step: 'sfix',
        name: 'Arreglar',
        count: 2,
        outcome: { kind: 'dropped' },
        current: false,
        open: true,
      },
    ]);
    const done = [...crossed(), moved('sfix__review', 'done', you, '2026-01-09T00:00:00Z')];
    expect(stepRounds(errores(), 'done', done).at(-1)).toMatchObject({
      step: 'sfix',
      outcome: { kind: 'done' },
      open: true,
    });
  });

  it('is the one step it is on when it never moved, and leaves out a move taken back', () => {
    expect(brief(stepRounds(errores(), 'sfix', [created('sfix')]))).toEqual([
      { step: 'sfix', name: 'Arreglar', count: 1, outcome: undefined, current: true, open: true },
    ]);
    const on = moved('striage', 'sfix', you, '2026-01-03T00:00:00Z');
    const events: ItemEvent[] = [
      created('striage'),
      on,
      {
        ...moved('sfix', 'striage', you, '2026-01-03T00:00:05Z'),
        data: { from: 'sfix', to: 'striage', undoes: on.id },
      },
    ];
    expect(stepRounds(errores(), 'striage', events).map(({ step }) => step)).toEqual(['striage']);
  });

  // A step deleted from the board since: the name its event kept, else said to be gone, as the
  // history reads it; never its bare id.
  const names = (groups: ReturnType<typeof stepRounds>) =>
    groups.map(({ name, outcome }) => ({ name, outcome }));

  it('says a step since removed when its events kept no name, in either language', () => {
    const events = [
      created('sgone'),
      moved('sgone', 'sfix', you, '2026-01-02T00:00:00Z'),
      moved('sfix', 'sgone', you, '2026-01-03T00:00:00Z'),
      moved('sgone', 'sfix', you, '2026-01-04T00:00:00Z'),
    ];
    setLanguage('es');
    try {
      expect(names(stepRounds(errores(), 'sfix', events))).toEqual([
        { name: 'un paso que ya no existe', outcome: { kind: 'reworked' } },
        { name: 'Arreglar', outcome: undefined },
      ]);
    } finally {
      setLanguage('en');
    }
    const groups = stepRounds(errores(), 'striage', [
      ...events,
      moved('sfix', 'sgone', you, '2026-01-05T00:00:00Z'),
      moved('sgone', 'striage', you, '2026-01-06T00:00:00Z'),
    ]);
    expect(groups.find(({ step }) => step === 'sgone')?.name).toBe('a step since removed');
    expect(groups.find(({ step }) => step === 'sfix')?.outcome).toEqual({
      kind: 'back',
      to: 'a step since removed',
    });
  });

  it('reads a step since removed by the name its event kept', () => {
    const events: ItemEvent[] = [
      { ...created('sgone'), data: { state: 'sgone', stateName: 'Dibujar' } },
      moved('sgone', 'sfix', you, '2026-01-02T00:00:00Z'),
    ];
    expect(stepRounds(errores(), 'sfix', events)[0]?.name).toBe('Dibujar');
  });
});

describe('railStep: the step whose rounds the compare rail shows', () => {
  // Triar → Arreglar, sent back once in its review, then back to Triar.
  const events = [
    created('striage'),
    moved('striage', 'sfix', you, '2026-01-02T00:00:00Z'),
    moved('sfix', 'sfix__review', agent('mender'), '2026-01-03T00:00:00Z'),
    moved('sfix__review', 'sfix', you, '2026-01-04T00:00:00Z'),
    moved('sfix', 'sfix__review', agent('mender'), '2026-01-05T00:00:00Z'),
    moved('sfix__review', 'striage', you, '2026-01-06T00:00:00Z'),
  ];

  it('is the step it is on until another is chosen, and the chosen one while it stands', () => {
    const groups = stepRounds(errores(), 'striage', events);
    expect(railStep(groups, undefined)).toBe('striage');
    expect(railStep(groups, 'sfix')).toBe('sfix');
    // A step the item never went through (a stale choice) gives way to the current one.
    expect(railStep(groups, 'sfill')).toBe('striage');
  });

  it('is the last step of a closed item, which stands open', () => {
    const done = [
      ...events.slice(0, 5),
      moved('sfix__review', 'done', you, '2026-01-06T00:00:00Z'),
    ];
    expect(railStep(stepRounds(errores(), 'done', done), undefined)).toBe('sfix');
  });

  it('follows the step just unfolded, and goes back to the default when that one folds', () => {
    expect(selectOnFold(undefined, 'sfix', true)).toBe('sfix');
    expect(selectOnFold('sfix', 'sfill', true)).toBe('sfill');
    expect(selectOnFold('sfix', 'sfix', false)).toBeUndefined();
    // Folding a step the rail does not show leaves the rail where it is.
    expect(selectOnFold('sfix', 'sfill', false)).toBe('sfix');
  });
});

// P3C-R3-4: the branch line follows the board's land step, which may merge through the forge, and
// in review it says only what holds: agents leave the branch alone, and a push by anyone else shows
// on the page (the drift warning, P3C-R3-1).
describe('branchSaid', () => {
  it('names the land step rather than how it merges, and is honest about review', () => {
    setLanguage('es');
    const landing = {
      tone: 'ok',
      key: 'landing',
      value: 'feat/x',
      step: 'Integrar',
      base: 'main',
    } as const;
    expect(branchSaid(landing)).toBe(
      'un agente la integra en main a continuación, como dice el paso Integrar',
    );
    const frozen = { tone: 'frozen', key: 'frozen', value: 'feat/x', step: 'Hacerlo' } as const;
    expect(branchSaid(frozen)).toBe(
      'los agentes no la tocan mientras la revisas; si alguien más sube, lo verás aquí',
    );
    setLanguage('en');
    expect(branchSaid(landing)).toBe('an agent lands it in main next, as the Integrar step says');
    expect(branchSaid(frozen)).toBe(
      'agents leave it alone while you review it; if anyone else pushes, it shows here',
    );
  });

  // P1-R3-9: an item merged by hand still read «un agente la integra en main ahora»; the PC tells
  // the page when git shows its branch in the base already, as the CLI says "merged outside Otea".
  it('says a branch merged outside Otea is in the base already, and what is left', () => {
    const landing = {
      tone: 'ok',
      key: 'landing',
      value: 'feat/x',
      step: 'Integrar',
      base: 'main',
    } as const;
    const outside = { branch: 'feat/x', base: 'main', land: 'Integrar' };
    setLanguage('es');
    expect(branchSaid(landing, outside)).toBe(
      'ya está en main, integrada fuera de Otea: un agente cierra el paso Integrar',
    );
    setLanguage('en');
    expect(branchSaid(landing, outside)).toBe(
      'in main already, merged outside Otea: an agent closes the Integrar step',
    );
  });

  // Field study 3: an item was Done with its work on the remote's main while the person's local
  // main never moved, and nothing said so. A Done item says it, with the way to catch up.
  it('says the local base is behind what landed, and how to catch up', () => {
    const behind = {
      base: 'main',
      remote: 'origin/main',
      behind: 2,
      checkout: 'D:\\work\\app',
      state: 'ready',
    } as const;
    setLanguage('es');
    expect(localBehindSaid(behind)).toBe(
      'Subido a origin/main, pero en tu main local van 2 commits atrasados: en D:\\work\\app ejecuta git pull --ff-only',
    );
    expect(localBehindSaid({ ...behind, behind: 1 })).toContain('va 1 commit atrasado');
    expect(localBehindSaid({ ...behind, behind: 3, state: 'changes' })).toContain(
      'van 3 commits atrasados',
    );
    expect(localBehindSaid({ ...behind, behind: 3, state: 'elsewhere', on: 'x' })).toContain(
      'van 3 commits atrasados',
    );
    expect(localBehindSaid({ ...behind, state: 'changes' })).toContain('tiene cambios tuyos');
    expect(localBehindSaid({ ...behind, state: 'elsewhere', on: 'feat/x' })).toContain(
      'está en feat/x',
    );
    setLanguage('en');
    expect(localBehindSaid(behind)).toBe(
      'Landed on origin/main, but your local main is 2 commits behind: run git pull --ff-only in D:\\work\\app',
    );
  });

  // P6-R3-2: only the agent's local main held the branch, and the desk said «fusionada fuera de
  // Otea», as if nothing was left but to close it.
  it('says a branch only the local base holds is to be pushed', () => {
    const landing = {
      tone: 'ok',
      key: 'landing',
      value: 'feat/x',
      step: 'Integrar',
      base: 'main',
    } as const;
    const local = {
      branch: 'feat/x',
      base: 'main',
      land: 'Integrar',
      local: { remote: 'origin/main', push: 'origin' },
    };
    setLanguage('es');
    expect(branchSaid(landing, local)).toBe('está en tu main local; súbelo (git push origin main)');
    setLanguage('en');
    expect(branchSaid(landing, local)).toBe('in your local main; push it (git push origin main)');
  });
});
