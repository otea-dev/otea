import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { isClosed, NOTE_REF, positionOf } from '../../../../src/core/board/engine.ts';
import { DONE, SAME, stepById } from '../../../../src/core/board/model.ts';
import { waitsOf } from '../../actions.ts';
import type { NoteAnchorInput } from '../../api.ts';
import { typeOfItem, useApp } from '../../app/context.tsx';
import { boardOfCollection, boardsOf, useBoards } from '../../board-studio/home/boards-store.ts';
import { boardSpeech } from '../../board-words.ts';
import { DeskReader } from '../../components/evidence/DeskReader.tsx';
import { EvidenceReader, type ReaderNote } from '../../components/evidence/EvidenceViewer.tsx';
import { ItemEvidence, ItemReview } from '../../components/evidence/item-evidence.ts';
import { READ_AT, type ReaderPick } from '../../components/evidence/reader-pick.ts';
import { noteAnchor } from '../../components/evidence/video-moment.ts';
import { blindPartsOf } from '../../evidence.ts';
import { t, tx } from '../../i18n/i18n.ts';
import { TypeIcon } from '../../icons/TypeIcon.tsx';
import { detailBlocks, slotData } from '../../item-types.ts';
import { GhostButton, Icon, StepPill, Swap, toast } from '../../kit/index.ts';
import { laneOf } from '../../lanes/geometry.ts';
import { lookOf } from '../../lanes/looks.ts';
import { NodeGlyph } from '../../lanes/NodeGlyph.tsx';
import {
  goneHolder,
  silentHolder,
  unheard,
  unheardLead,
  waitingToLand,
  workingAgents,
} from '../../listening.ts';
import { BottomSheet } from '../../phone/BottomSheet.tsx';
import { ItemTypeScope, stateWord, stateWordIn, typeWord } from '../../preset-words.ts';
import { usePlainReview } from '../../review-detail.ts';
import { roundsOf } from '../../rounds.ts';
import { studioHash } from '../../selection.ts';
import type { ItemView, RelatedItem } from '../../types.ts';
import { useStudioBoard } from '../board/studio-board.tsx';
import { FromBandeja } from '../hablar/FromBandeja.tsx';
import { FromTurns } from '../hablar/FromTurns.tsx';
import { ItemTopics } from '../topics/ItemTopics.tsx';
import { Acts, actsModeOf } from './Acts.tsx';
import {
  BranchLine,
  branchNoticeCount,
  DraftRequestLine,
  type DropChoice,
  DropDialog,
  HandChecklist,
  LinksSection,
  PartOfLine,
  PartsSection,
  RequestChangedLine,
  RoundNotes,
  WaitChecklist,
} from './BoardSections.tsx';
import { Body, bodySections, Plain } from './Body.tsx';
import {
  approvalRefusal,
  backOf,
  boardItemOf,
  branchStrip,
  deliverLabel,
  evidenceGaps,
  handRefusal,
  handRows,
  holdApproval,
  type ItemBoardBlock,
  linksOf,
  noRemoteOf,
  ownStepOf,
  railStep,
  roundStartOf,
  selectOnFold,
  sheetLook,
  shortGroupCaution,
  stepRounds,
  waitBlock,
  waitRows,
} from './board-item.ts';
import { cautionKeyOf, useCaution } from './caution.ts';
import { Details, detailCells, Value } from './Details.tsx';
import { useDiffFiles, useDiffOffTip } from './diff-tip.ts';
import { useDrift } from './drift.ts';
import { boardFactsOf, factsOf, standAgentOf, standOf } from './facts.ts';
import { pressInView, toastOf } from './frame.ts';
import { History } from './History.tsx';
import { historyOf } from './history.ts';
import { useLocalBehind } from './local-behind.ts';
import { useMergeOnly } from './merge-only.ts';
import { useMergedOutside } from './merged-outside.ts';
import { draftWaitsOf, type MoveChoice, planMoves } from './moves.ts';
import { NotesForm } from './NotesForm.tsx';
import { AnchorPicker, clearOfToast, NotesSection, RoundNotesLine } from './NotesThread.tsx';
import { draftKeyOf } from './note-draft.ts';
import {
  anchorPieces,
  notedOn,
  notesCount,
  quietMinutes,
  roundNotesOf,
  threadOf,
} from './notes.ts';
import { useOpened } from './opened.ts';
import { useOverlaps } from './overlaps.ts';
import { PhoneItem, type WorkedSec } from './PhoneItem.tsx';
import { ProofChecklist } from './ProofChecklist.tsx';
import { partNames, phoneRounds, readerOf, requestLine, unopenedOf } from './phone-review.ts';
import { pickOf, pickWays } from './pick.ts';
import { Route } from './Route.tsx';
import { useRoundSame } from './round-same.ts';
import { routeIndex, routeSteps } from './route.ts';

// The item's sheet content (SPEC §10.3): the bar, the headline and standfirst, the route, the moves,
// Details, the body and History, laid out stacked or, from a 1240 px sheet, in two columns.

export type SheetNav = { prev: boolean; next: boolean };

type ItemSheetProps = {
  item: ItemView;
  full: boolean;
  nav: SheetNav;
  onNav: (dir: -1 | 1) => void;
  onFull: () => void;
  onClose: () => void;
};

const quietFor = (iso: string | undefined, now: number): string | null => {
  if (!iso) return null;
  const m = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 60
    ? t('when.minutes', { minutes: m })
    : t('when.hours', { hours: Math.round(m / 60) });
};

const dipWhen = (iso: string, now: number): string => {
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(Date.parse(iso)) === day(now)) return t('sheet.when.today');
  if (day(Date.parse(iso)) === day(now - 86_400_000)) return t('sheet.when.yesterday');
  const lang = document.documentElement.lang || undefined;
  const within = now - Date.parse(iso) < 6 * 86_400_000;
  const fmt = new Intl.DateTimeFormat(
    lang,
    within ? { weekday: 'long' } : { day: 'numeric', month: 'short' },
  );
  return t('sheet.when.on', { day: fmt.format(Date.parse(iso)) });
};

// Where a note goes: to the agent by its name, or "al agente" when none holds the step yet. On an
// item an agent set aside, the note takes it up again (P7-R3-1), and says so (P5-R3-11).
export function leaveSays(agent: string | null, aside = false): ReactNode {
  if (aside)
    return agent
      ? tx('notes.leaveSaysAside', { agent: <b>{agent}</b> })
      : t('notes.leaveSaysAsideAny');
  return agent ? tx('notes.leaveSays', { agent: <b>{agent}</b> }) : t('notes.leaveSaysAny');
}

// Why the item was dropped: what the move that closed it said, when it said anything.
function dropReason(item: ItemView): string | undefined {
  const closing = item.events.findLast(
    (e) => e.type === 'transitioned' && e.data.to === item.state,
  );
  const reason = typeof closing?.data.reason === 'string' ? closing.data.reason.trim() : '';
  return reason || undefined;
}

export function ItemSheet({ item, full, nav, onNav, onFull, onClose }: ItemSheetProps) {
  const app = useApp();
  // What only code readers use (branch, diff, checks) folds behind «Detalles técnicos»: always on
  // the phone, and on the desk when the person chose it in Preferencias.
  const plain = usePlainReview(app.phone);
  // The board this item is on, when Studio shapes it: Editar tablero opens its editor.
  const summaries = boardsOf(useBoards(app.version));
  const board = boardOfCollection(summaries, item.collection);
  const type = typeOfItem(item, app.collectionOf);
  const word = (s: string) => stateWord(type, s);
  const now = app.now;
  // On a published board the step engine says whose turn it is, the step's round and the route.
  const live = useStudioBoard(item.collection, item.archived?.id)?.live;
  const look = sheetLook(lookOf(item, now), live !== undefined);
  const onBoard = useMemo(
    () =>
      live
        ? boardItemOf(
            live,
            item,
            {
              done: boardSpeech(live).done,
              dip: (n, at) => t('sheet.dip', { n, when: at ? dipWhen(at, now) : '' }),
              redone: (n) => t('sheet.dipRedone', { n }),
              reopen: (at) => t('sheet.reopenDip', { when: at ? dipWhen(at, now) : '' }),
              bounce: (n) => t('sheet.dipBounced', { n }),
            },
            item.bounced,
          )
        : null,
    [live, item, now],
  );
  // Your own step (Propuesta, Triar): yours to fill and hand off, not a review.
  const ownStep = live ? ownStepOf(live, item) : undefined;
  // What the server read of the item on its board; once closed, who did its work and approved it.
  const closedBy = (item as ItemView & { board?: ItemBoardBlock }).board?.closedBy;
  const facts = useMemo(() => {
    const read = factsOf(item, type, now);
    const on = onBoard ? boardFactsOf(read, item, onBoard, ownStep !== undefined) : read;
    // A closed item was done by the agent that handed its work off, never by its reviewer.
    if (closedBy?.doneByPerson) return { ...on, agent: null, handed: null };
    return closedBy?.doer ? { ...on, agent: closedBy.doer } : on;
  }, [item, type, now, onBoard, ownStep, closedBy]);
  const lane = onBoard?.route.lane ?? laneOf(item.turn);
  // ---- what a Studio board adds: parts, links, waits, branch, rounds, motives (board-item.ts) ----
  const block = (item as ItemView & { board?: ItemBoardBlock }).board;
  const planned = planMoves(item.transitions, {
    own: facts.own,
    word,
    waits: waitsOf(item),
    draftWaits: draftWaitsOf(block),
  });
  const nameOf = (r: RelatedItem) => {
    const types = app.collectionOf(r.collection)?.types ?? [];
    const said = stateWordIn(types, r.closes === 'done' ? 'done' : r.state);
    const step = said === 'done' ? t('bs.done') : said;
    return { board: r.collection, step };
  };
  const links = live ? linksOf({ relations: item.relations, board: block }, nameOf) : null;
  const position = positionOf(item.state);
  const stepId = isClosed(position) ? null : position.step;
  const waits = live && links && stepId ? waitRows(live, stepId, links) : [];
  const strip = live
    ? branchStrip(live, item.state, item.fields, {
        merged: !!block?.merged,
        local: noRemoteOf(item),
      })
    : null;
  // While the person reviews it: what a clone without Otea's hook pushed since the handoff.
  const drift = useDrift(item.id, strip?.key === 'frozen', item.updatedAt);
  // In its land step: whether git shows it merged outside Otea already (P1-R3-9).
  const outside = useMergedOutside(item.id, strip?.key === 'landing', item.updatedAt);
  // Done: whether what landed is on the remote's base and the local one is behind it.
  const behind = useLocalBehind(
    item.id,
    isClosed(position) && position.closed === DONE,
    item.updatedAt,
  );
  // While the person reviews it: whether the attached diff comes from another tip (P1-R3-1).
  const off = useDiffOffTip(item.id, strip?.key === 'frozen', item.updatedAt);
  // And whether it names other files than the work handed off changes (P1-F2).
  const files = useDiffFiles(item.id, strip?.key === 'frozen', item.updatedAt);
  // And whether this round holds the same files as the one it answers (P5-F2).
  const same = useRoundSame(item.id, strip?.key === 'frozen', item.updatedAt);
  // And which other open items change the same files, so one of them meets a conflict.
  const overlaps = useOverlaps(item.id, strip?.key === 'frozen');
  // And whether this round only merges main into what was approved: the review is that merge.
  const merge = useMergeOnly(item.id, strip?.key === 'frozen');
  const split = live?.split;
  const childSummary =
    split && split.board !== SAME ? summaries.find((b) => b.id === split.board) : undefined;
  const childCollection = split
    ? split.board === SAME
      ? item.collection
      : (childSummary?.collection ?? null)
    : null;
  const childItem = split
    ? split.board === SAME
      ? (live?.item ?? '')
      : (childSummary?.item ?? '')
    : '';
  const partsName =
    split && split.board !== SAME
      ? (links?.partsBoard ?? childSummary?.name ?? t('bi.parts.title'))
      : t('bi.parts.title');
  const roundsStep = live && stepId ? stepById(live, stepId) : undefined;
  // Every step it went through with its rounds, the step it is on last.
  const journey = live ? stepRounds(live, item.state, item.events) : [];
  // The step whose rounds the compare rail under Rondas shows: the one unfolded last there, else
  // the step it is on; named in the rail's title when the item went through several.
  const [chosen, setChosen] = useState<{ item: string; step?: string }>({ item: item.id });
  const chosenStep = chosen.item === item.id ? chosen.step : undefined;
  const rail = railStep(journey, chosenStep);
  const railName = journey.length > 1 ? journey.find(({ step }) => step === rail)?.name : undefined;
  const onFold = (step: string, opening: boolean) => {
    const next = selectOnFold(chosenStep, step, opening);
    setChosen(next === undefined ? { item: item.id } : { item: item.id, step: next });
  };
  const block0 = (item as ItemView & { board?: ItemBoardBlock }).board;
  const missing = block0?.missing ?? [];
  // On your own step the primary hands it off, named by the step ("Triar"), asking for the note when the step does;
  // while what the step waits for is open it stays off and says what it waits for.
  const held = waitBlock(waits);
  const deliver =
    ownStep && planned.primary
      ? {
          ...planned.primary,
          label: deliverLabel(ownStep, live ? { def: live, fields: item.fields } : undefined),
          deliver: true,
          ...(held ? { blocked: held } : {}),
          move: {
            ...planned.primary.move,
            reasonRequired:
              planned.primary.move.reasonRequired || missing.some(({ ref }) => ref === 'note'),
          },
        }
      : holdApproval(planned.primary, waits);
  const plan = live
    ? {
        ...planned,
        primary: deliver,
        quiet: planned.quiet.map((c) => {
          const to = positionOf(c.move.to);
          if (c.kind !== 'sendback' || isClosed(to) || to.step === stepId) return c;
          return {
            ...c,
            label: t('bi.backTo', { step: stepById(live, to.step)?.name ?? to.step }),
          };
        }),
      }
    : planned;
  const motives = plan.close.some((c) => c.move.to.startsWith('dropped__'));
  const dropChoices: DropChoice[] = plan.close
    .filter((c) => !motives || c.move.to !== 'dropped')
    .map((c) => ({ to: c.move.to, name: word(c.move.to) }));
  const [dropping, setDropping] = useState(false);
  const drop = (choice: DropChoice, reason: string) => {
    setDropping(false);
    void app
      .move(
        item.id,
        choice.to,
        reason,
        t('bi.drop.done', { title: item.title, motive: choice.name }),
      )
      .catch(() => undefined);
  };
  const refuse = (c: MoveChoice) =>
    c.kind === 'approve'
      ? approvalRefusal(item.id, waits)
      : c.kind === 'own' && ownStep
        ? handRefusal(item.id, missing)
        : null;
  // Approving a delivery whose "at least N of" group is short asks once (a second press approves).
  // Asked here, for the page and for the reader (useCaution): a file attached meanwhile asks again.
  const cautionOf = (c: MoveChoice) =>
    live && c.kind === 'approve'
      ? shortGroupCaution(evidenceGaps(live, item).groups, c.label)
      : null;
  const careful = useCaution(cautionKeyOf(item), cautionOf);
  const filled = (ref: string) => {
    const value = item.fields[ref];
    const held = Array.isArray(value)
      ? value.length > 0
      : value != null && String(value).trim() !== '';
    return held || item.evidence.some(({ module }) => module === ref);
  };
  const hand =
    live && ownStep ? handRows(live, ownStep, missing, item.fields, filled, block0?.waived) : [];

  // ---- notes to the agent while it does its step (the notes mock) ----
  const thread = useMemo(() => threadOf(block, item.events), [block, item.events]);
  const agentStep =
    live && roundsStep && !ownStep && !isClosed(position) && position.phase === 'doing'
      ? roundsStep
      : undefined;
  const round = onBoard?.round ?? 0;
  const roundNotes = agentStep ? roundNotesOf(thread, agentStep.id, round) : [];
  // The round each step has got to: a review comment shows only in the round it went to (P5-8).
  const reachedOf = (s: string) =>
    Math.max(
      s === stepId ? round : 0,
      ...(journey.find((j) => j.step === s)?.rounds.map((r) => r.round) ?? [0]),
    );
  // While you review a step: comments on what was handed, which go with a send-back.
  const reviewing =
    live &&
    roundsStep &&
    !isClosed(position) &&
    position.phase === 'review' &&
    roundsStep.reviewer === 'you' &&
    app.session.canWrite
      ? roundsStep
      : undefined;
  const reviewComments = reviewing
    ? thread.filter((n) => n.review && n.step === reviewing.id && n.round === round)
    : [];
  const { unanswered } = notesCount(roundNotes);
  const worker = block?.worker;
  const noteTo = worker?.name ?? facts.agent;
  // What the agent has to hand, read only: its parts, then the wait for your notes' answers.
  const agentHand =
    live && agentStep
      ? handRows(live, agentStep, missing, item.fields, undefined, block0?.waived)
      : [];
  const deliverable = agentHand.filter((r) => r.required && r.ref !== NOTE_REF);
  const had = { done: deliverable.filter((r) => r.ok).length, of: deliverable.length };
  const pieces = useMemo(
    () => (live && agentStep ? anchorPieces(item.evidence, roundStartOf(live, item)) : []),
    [live, agentStep, item],
  );
  const noted = useMemo(() => notedOn(thread), [thread]);
  // While the agent's question waits for you, you answer it rather than leave a note.
  const canNote = !!agentStep && app.session.canWrite && !item.asks;
  const mode = actsModeOf({
    look,
    canWrite: app.session.canWrite,
    question: facts.question,
    plan,
    asks: !!item.asks,
    aside: !!item.setAside,
    offline: app.sync?.offline === true,
  });
  // Reviewing an item that carries options, you pick one as you approve: the ways on are named for
  // the pick, and the moves keep the rest (the send-backs, the closes).
  const options = reviewing && live && stepId ? pickOf(live, item, block?.chosen) : undefined;
  const ways =
    options && live && stepId && mode === 'moves' ? pickWays(plan, live, stepId, word) : null;
  const picking =
    options && ways && ways.ways.length > 0 ? { pick: options, ways: ways.ways } : undefined;
  const actsMode = picking ? 'pick' : mode;
  const actsPlan = picking && ways ? ways.rest : plan;
  const steps = onBoard ? onBoard.route.steps : type ? routeSteps(type) : [];
  const ci = onBoard ? onBoard.route.ci : type ? routeIndex(type, item.state, facts.visited) : 0;
  // Its holder is no longer connected, and the lease alone keeps it (P7-R3-10).
  const gone = look === 'working' ? goneHolder(item, app.agents, now) : null;
  // Its holder never picked up your answer to its question, and what waits behind it to land
  // (P6-R3-4).
  const unread = look === 'working' ? silentHolder(item, app.agents, item.events, now) : null;
  const stand = standOf({
    look,
    agent: standAgentOf(facts, onBoard !== null && item.turn === 'agent', !!closedBy?.doer),
    round: facts.round,
    question: facts.question,
    own: facts.own,
    quiet: look === 'stuck' ? quietFor(item.expiredLease?.expiresAt, now) : null,
    left: facts.left,
    why: look === 'dropped' ? dropReason(item) : undefined,
    archived: item.archived?.board,
    reopened: onBoard?.reopened?.why,
    byYou: !!closedBy?.doneByPerson,
    aside: item.setAside?.by,
    landing: item.landing,
    waits: item.landsAfter?.overlap ? item.landsAfter.first : undefined,
    merging: item.merging?.after,
    bounced: item.bounced ? item.bounced.reason : undefined,
    asksOn: item.holderAsks,
    gone: gone
      ? { agent: gone.name, ended: gone.sessionEnded === true, quiet: quietFor(gone.lastSeen, now) }
      : undefined,
    unread: unread
      ? {
          agent: unread.agent,
          quiet: quietFor(unread.since, now),
          behind: waitingToLand(item, app.all, live, now),
        }
      : undefined,
  });
  const standWords = tx(
    stand.key as 'sheet.stand.handedRound',
    {
      agent: <b>{stand.agent}</b>,
      round: stand.round ?? 0,
      ...(stand.time ? { time: stand.time } : {}),
      ...(stand.why ? { why: stand.why } : {}),
      ...(stand.board ? { board: stand.board } : {}),
      ...(stand.item ? { item: <b>{stand.item}</b> } : {}),
    } as never,
  );
  // An item nobody will bring an agent to says so in its header too, not only below (P8-R2-7).
  const silentHere = unheard(item, app.agents, now);
  const standText = silentHere ? (
    <>
      {standWords}{' '}
      {unheardLead(workingAgents(app.agents, app.all, now, item.collection), app.agents, item.id)}
    </>
  ) : (
    standWords
  );
  const pathIndex = (state: string) => (type ? routeIndex(type, state, facts.visited) : -1);
  const presetDips = facts.sentBack.map((r) => ({
    at: pathIndex(r.state),
    label: t('sheet.dip', { n: r.n, when: dipWhen(r.at, now) }),
  }));

  // The notes form, drawn from the button that asked for it.
  const [notes, setNotes] = useState<{
    choice: MoveChoice;
    button: HTMLButtonElement;
    open: boolean;
    below: number | null;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const openNotes = (choice: MoveChoice, button: HTMLButtonElement) => {
    if (notes?.open && notes.choice.move.to === choice.move.to) {
      setNotes({ ...notes, open: false });
      return;
    }
    const below = root.current?.querySelector('.d-details')?.getBoundingClientRect().top ?? null;
    setNotes({ choice, button, open: true, below: notes ? null : below });
  };
  // The note to the agent at work, drawn from «Dejar una nota» as the notes form is.
  const [noting, setNoting] = useState<{
    button: HTMLButtonElement;
    open: boolean;
    below: number | null;
  } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const toggleNote = (button: HTMLButtonElement) => {
    if (noting?.open) {
      setNoting({ ...noting, open: false });
      return;
    }
    const below = root.current?.querySelector('.d-details')?.getBoundingClientRect().top ?? null;
    setAnchor(null);
    setNoting({ button, open: true, below: noting ? null : below });
  };
  // True once the note went; on a failure the box it was typed in keeps it.
  const postNote = (text: string, on?: NoteAnchorInput): Promise<boolean> =>
    app.note(item.id, text, on).then(
      () => {
        toast({
          // To the agent by its name, or «al agente» while none has taken the step yet.
          msg: reviewing
            ? t('notes.review.saved', { title: item.title })
            : noteTo
              ? t('notes.sent', { agent: noteTo, title: item.title })
              : t('notes.sentAny', { title: item.title }),
          id: item.id,
        });
        requestAnimationFrame(() => root.current && clearOfToast(root.current));
        return true;
      },
      () => {
        toast({ msg: t('notes.failed'), id: item.id });
        return false;
      },
    );
  const sendNote = (text: string) => {
    if (!noting) return;
    // On a recording, the moment its player is at goes with the note. The form closes once it went.
    void postNote(text, noteAnchor(anchor)).then((went) => {
      if (went) setNoting((n) => (n ? { ...n, open: false } : n));
    });
  };
  // The reader's note: what it sends, and the notes already left on its files, drawn where they are;
  // the comments of the review still open can be changed or taken back before they go (P5-3).
  const notChanged = () => {
    toast({ msg: t('notes.failed'), id: item.id });
    return false;
  };
  const readerNote: ReaderNote | undefined =
    canNote || reviewing
      ? {
          onSend: (text, on) => postNote(text, on),
          left: thread,
          pending: (n) =>
            !!reviewing && n.review !== undefined && n.step === reviewing.id && n.round === round,
          onEdit: (n, text) => app.editNote(item.id, n, text).then(() => true, notChanged),
          onWithdraw: (n) => app.withdrawNote(item.id, n).then(() => true, notChanged),
        }
      : undefined;
  const quiet = canNote ? quietMinutes(worker, now) : null;
  const who = noteTo ?? t('notes.anyAgent');
  // After the note: the agent has gone quiet, or how many deliverables were in and when it reads.
  const noteSays =
    quiet !== null
      ? t('notes.quiet', { agent: who, minutes: quiet })
      : [had.of > 0 ? t('notes.had', { done: had.done, count: had.of }) : null, t('notes.nextBeat')]
          .filter(Boolean)
          .join(' · ');
  const leave = canNote
    ? {
        open: !!noting?.open,
        says: leaveSays(noteTo ?? null, !!item.setAside),
        onToggle: toggleNote,
      }
    : undefined;
  const send = (text: string) => {
    if (!notes) return;
    const c = notes.choice;
    const kind = c.deliver ? 'deliver' : c.move.closes === 'done' ? 'close' : c.kind;
    setNotes({ ...notes, open: false });
    app
      .move(item.id, c.move.to, text, toastOf(kind, item.title, word(c.move.to)))
      .catch(() => toast({ msg: t('sheet.refused'), id: item.id }));
  };

  // ---- the reader: the round's files one at a time, opened from the evidence (review mock) ----
  // Closed, the phone reads the last round handed off (the rounds it draws, see PhoneItem); the
  // desk, the step its history opens on.
  const readerStep =
    stepId ?? (app.phone ? null : (journey.find(({ open }) => open)?.step ?? null));
  const readerRounds = useMemo(() => {
    const on = live ? { def: live, ...(readerStep ? { step: readerStep } : {}) } : undefined;
    const read = roundsOf(item.events, item.evidence, type?.states ?? [], on);
    return phoneRounds(read, item.turn === 'human');
  }, [item.events, item.evidence, item.turn, type, live, readerStep]);
  // The round each file was handed in, for the modules that say it (P5-5).
  const roundOf = useMemo(
    () => new Map(readerRounds.flatMap((r) => r.evidence.map((e) => [e.id, r.n] as const))),
    [readerRounds],
  );
  const handed = useMemo(
    () => readerOf(readerRounds, item.evidence, blindPartsOf(type)),
    [readerRounds, item.evidence, type],
  );
  // While the agent works, the reader reads this round's files, the ones a note can be on.
  const reader = useMemo(
    () => (agentStep ? readerOf([], pieces) : handed),
    [agentStep, pieces, handed],
  );
  const parts = useMemo(() => (type ? partNames(type.layout) : undefined), [type]);
  const review = { note: reviewing ? readerNote : undefined, roundOf };
  const [reading, setReading] = useState<{ item: string; at: number; open: boolean } | null>(null);
  // The files opened in the reader, on this device or another (opened.ts).
  const [seen, markSeen] = useOpened(item.id, app.session.canWrite);
  const readAt = reading?.item === item.id ? reading : null;
  const shownId = readAt?.open ? reader.files[readAt.at]?.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per file shown
  useEffect(() => {
    if (shownId !== undefined) markSeen(shownId);
  }, [shownId, item.id]);
  const [start, setStart] = useState<ReaderPick | undefined>(undefined);
  // Opened to write a note on `start` (a line of the inline diff), not to read it.
  const [write, setWrite] = useState(false);
  const onRead = (id?: number, pick?: ReaderPick, writing = false) => {
    const at = id === undefined ? 0 : reader.files.findIndex((e) => e.id === id);
    setStart(pick);
    setWrite(writing);
    setReading({ item: item.id, at: Math.max(0, at), open: true });
  };
  // A note's cite on a line or a node opens the reader there; a line of the inline diff opens it
  // to write a note on that line, the focus in the note's box.
  useEffect(() => {
    const open = (e: Event) => {
      const {
        evidence,
        pick,
        write: writing,
      } = (e as CustomEvent<{ evidence: number; pick: ReaderPick; write?: boolean }>).detail;
      if (reader.files.some(({ id }) => id === evidence)) onRead(evidence, pick, writing === true);
    };
    window.addEventListener(READ_AT, open);
    return () => window.removeEventListener(READ_AT, open);
  });
  const closeReader = () => setReading((r) => (r ? { ...r, open: false } : r));
  // A move made from inside the reader is the page's own: the reader closes, then the move's button
  // below is pressed, so a refusal or the notes form shows where it always does.
  const pressMove = (to: string) => {
    closeReader();
    let tries = 0;
    const press = () => {
      if (document.querySelector('.rd-dialog') && tries++ < 90) {
        requestAnimationFrame(press);
        return;
      }
      const button = root.current?.querySelector<HTMLButtonElement>(
        `[data-move="${CSS.escape(to)}"]`,
      );
      if (button) pressInView(button);
    };
    requestAnimationFrame(press);
  };
  const choices = plan.primary ? [plan.primary, ...plan.quiet] : plan.quiet;
  const approveChoice = choices.find((c) => c.kind === 'approve' && !c.blocked);
  const backChoice = plan.quiet.find((c) => c.kind === 'sendback' && !c.blocked);
  const deciding = mode === 'moves' && app.session.canWrite && !!(approveChoice || backChoice);
  const decide = deciding
    ? {
        seen: reader.files.filter((e) => seen.has(e.id)).length,
        notice: reviewComments.length
          ? t('notes.review.notice', { count: reviewComments.length })
          : undefined,
        back: backChoice
          ? { label: backChoice.label, onClick: () => pressMove(backChoice.move.to) }
          : undefined,
        // A group short asks once, here, with the reader open; the second press closes it and goes.
        approve: approveChoice
          ? {
              label: approveChoice.label,
              onClick: () => {
                if (careful.press(approveChoice) === null) pressMove(approveChoice.move.to);
              },
            }
          : undefined,
        warn: careful.line || undefined,
      }
    : undefined;
  const unseen = approveChoice && deciding ? unopenedOf(reader.files, seen) : null;
  // What Aprobar says in one line, never holding it: files left unopened, and the review comments
  // that would stay as notes of this round.
  const unopenedLine =
    [
      unseen && unseen.unopened > 0
        ? t('evidence.reader.unopened', { n: unseen.unopened, total: unseen.total })
        : '',
      deciding && reviewComments.length
        ? t('notes.review.notice', { count: reviewComments.length })
        : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const canRead = app.session.canWrite && reader.files.length > 0;

  const cells = detailCells({
    item,
    type,
    facts,
    own: facts.own && look === 'yours',
    now,
    board: live
      ? {
          reviewer: roundsStep ? roundsStep.reviewer : 'none',
          ...(closedBy ? { reviewedBy: closedBy.reviewer ?? null } : {}),
          ...(closedBy?.reviewerRelayedBy ? { relayedBy: closedBy.reviewerRelayedBy } : {}),
        }
      : undefined,
    agents: app.agents,
    types: app.collectionOf(item.collection)?.types.length,
  });
  const canWrite = app.session.canWrite;
  const proofSections = (block?.checklists ?? []).map((list) => ({
    key: `bi:proof:${list.part}`,
    node: (
      <ProofChecklist
        list={list}
        short={(block?.missing ?? []).some(({ ref }) => ref === list.part)}
        onRead={
          canRead
            ? (id: number, line?: number) => onRead(id, line ? { line } : undefined)
            : undefined
        }
      />
    ),
  }));
  const boardSections =
    live && links
      ? [
          ...proofSections,
          ...(split && childCollection
            ? [
                {
                  key: 'bi:parts',
                  node: (
                    <PartsSection
                      item={item}
                      links={links}
                      boardName={partsName}
                      childItem={childItem}
                      childCollection={childCollection}
                      canWrite={canWrite}
                      now={now}
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'bi:links',
            node: (
              <LinksSection
                item={item}
                links={links}
                canWrite={canWrite}
                now={now}
                boardOf={(x) => x.collection}
              />
            ),
          },
        ]
      : [];
  const only = journey.length === 1 ? journey[0]?.rounds : undefined;
  const hasNotes =
    journey.length > 1 ||
    thread.length > 0 ||
    (!!only && (only.length > 1 || (only[0]?.notes.length ?? 0) > 0));
  const sections = bodySections({
    item,
    type,
    facts,
    canWrite,
    now,
    plain,
    onRead: canRead ? onRead : undefined,
    board: live
      ? {
          options: new Set(
            Object.values(live.parts)
              .filter((p) => p.show === 'options')
              .map((p) => p.id),
          ),
          chosen: block?.chosen,
          picking: !!picking,
          rounds: journey.length ? (
            <RoundNotes
              steps={journey}
              rail={rail}
              onFold={onFold}
              notes={(step, r) => (
                <RoundNotesLine
                  notes={roundNotesOf(thread, step, r, reachedOf)}
                  at={{ step, round: r }}
                  live={!!agentStep && step === agentStep.id && r === round}
                  evidence={item.evidence}
                  now={now}
                />
              )}
            />
          ) : null,
          // Where the board's layout places no Rondas, they come after the fields only when
          // there is something to say or a review to say it to.
          roundsAfter: hasNotes || (!!roundsStep && roundsStep.reviewer !== 'none'),
          sections: boardSections,
          steps: rail ? { def: live, step: rail } : { def: live },
          railName,
          noted,
          gaps: evidenceGaps(live, item),
        }
      : undefined,
  });
  // While the agent works, the round's thread comes first: it is all you can do there.
  if (agentStep && roundNotes.length)
    sections.unshift({
      key: 'notes',
      node: (
        <NotesSection
          notes={roundNotes}
          evidence={item.evidence}
          now={now}
          agent={noteTo}
          at={{ step: agentStep.id, round }}
        />
      ),
    });
  const lines = historyOf(item.events, type, word, now, live);
  const stateShown = word(item.state);
  const yours = item.turn === 'human';
  const route =
    steps.length > 0 ? (
      <Route
        id={item.id}
        steps={steps}
        words={
          onBoard
            ? onBoard.route.words
            : // A dropped item of a board: its reviews are visits, unnamed, as on the board's route.
              steps.map((s) => (live && s.name.endsWith('__review') ? '' : word(s.name)))
        }
        ci={ci}
        lane={lane}
        look={look}
        dips={onBoard ? onBoard.route.dips : presetDips}
        phone={app.phone}
      />
    ) : null;

  if (app.phone) {
    // On the phone: what was delivered first, the rounds as one segment, the moves docked. What
    // was asked is the item's fields; the rounds, the evidence and the board's sections are
    // drawn by the delivery, and links and parts stay on the computer.
    // On a board only the creation form's fields are what was asked: the rest (the findings, the
    // options, the sources an agent filled in) are its work, drawn as the desk draws them and not
    // kept in the closed «Lo pedido» (field study 3: a decision showed none of what was researched).
    const asked = new Set(live?.form.map(({ ref }) => ref));
    const fieldKey = (key: string) => key.slice(2);
    const request = sections.filter(
      ({ key }) => key.startsWith('f:') && (!live || asked.has(fieldKey(key))),
    );
    const longWork = live
      ? sections.filter(({ key }) => key.startsWith('f:') && !asked.has(fieldKey(key)))
      : [];
    // The short ones (a link, a number) are the desk's Details cells; here they stand with the rest.
    const blocks = detailBlocks(type, item.fields);
    const shortWork: WorkedSec[] = live
      ? [...blocks.primary, ...(blocks.sections ?? []).flatMap((s) => s.blocks), ...blocks.side]
          .flatMap((b) => (b.kind === 'fields' ? b.values : []))
          .filter(
            (v) => v.field.module !== 'markdown' && v.value !== '' && !asked.has(v.field.name),
          )
          .map((v) => ({
            key: `f:${v.field.name}`,
            ref: v.field.name,
            node: (
              <Plain k={`f:${v.field.name}`} label={v.label} className="d-sec field">
                <div {...slotData(v.at)}>
                  <Value placed={v} />
                </div>
              </Plain>
            ),
          }))
      : [];
    const worked: WorkedSec[] = [
      ...longWork.map((s) => ({ ...s, ref: fieldKey(s.key) })),
      ...shortWork,
    ];
    const firstField = request[0]?.key.slice(2);
    return (
      <ItemTypeScope type={type}>
        <ItemEvidence.Provider value={item.evidence}>
          <ItemReview.Provider value={review}>
            <PhoneItem
              item={item}
              type={type}
              board={
                live
                  ? // Closed, the rounds read are the last handed off (P5-F11): the step the history
                    // opens on can be one that never handed anything, and showed no evidence.
                    { def: live, step: stepId }
                  : undefined
              }
              look={look}
              facts={facts}
              plan={actsPlan}
              mode={actsMode}
              pick={picking}
              word={word}
              stand={standText}
              route={route}
              checks={
                <>
                  {/* Its branch and where it stands: «fusionada» once merged, as on the desk (WF-3). */}
                  <RequestChangedLine changed={item.requestChanged} />
                  {hand.length ? (
                    <HandChecklist item={item} rows={hand} canWrite={app.session.canWrite} />
                  ) : null}
                  {agentStep ? (
                    <HandChecklist
                      item={item}
                      rows={agentHand}
                      canWrite={false}
                      canWaive={app.session.canWrite}
                      notes={roundNotes.length ? { unanswered } : undefined}
                    />
                  ) : null}
                  {live ? <WaitChecklist rows={waits} child={partsName} now={now} /> : null}
                  {proofSections.map(({ key, node }) => (
                    <div key={key}>{node}</div>
                  ))}
                  <FromTurns turns={item.fromMessages} />
                  <FromBandeja from={item.fromBandeja} />
                  <ItemTopics item={item} canWrite={app.session.canWrite} />
                </>
              }
              technical={
                strip || behind ? (
                  <BranchLine
                    strip={strip}
                    behind={behind}
                    drift={drift}
                    outside={outside}
                    off={off}
                    files={files}
                    same={same}
                    item={item.id}
                    overlaps={overlaps}
                    merge={merge}
                    waits={item.landsAfter?.text}
                  />
                ) : undefined
              }
              technicalNotices={branchNoticeCount({
                behind,
                drift,
                off,
                files,
                same,
                merge,
                waits: item.landsAfter?.text,
                overlaps,
              })}
              details={<Details cells={cells} k={`${item.state}:${item.updatedAt}`} />}
              detailsSummary={[facts.agent, typeWord(type, item.type), item.collection]
                .filter(Boolean)
                .join(' · ')}
              worked={worked}
              request={request.length ? <Body id={item.id} sections={request} /> : null}
              requestSummary={firstField ? requestLine(String(item.fields[firstField] ?? '')) : ''}
              links={
                links &&
                (links.blockers.length || links.blocking.length || links.related.length) ? (
                  <LinksSection
                    item={item}
                    links={links}
                    canWrite={false}
                    now={now}
                    boardOf={(x) => x.collection}
                  />
                ) : null
              }
              linksSummary={
                links
                  ? [...links.blockers, ...links.blocking, ...links.related.flatMap((g) => g.items)]
                      .map((x) => x.id)
                      .join(' · ')
                  : ''
              }
              refuse={live ? refuse : undefined}
              caution={live ? cautionOf : undefined}
              back={live ? (to: string) => backOf(live, item, to) : undefined}
              onClose={onClose}
              notes={
                live
                  ? {
                      of: (n) => roundNotesOf(thread, stepId, n, reachedOf),
                      ...(stepId ? { step: stepId } : {}),
                      noted,
                      ...(canNote && agentStep
                        ? {
                            leave: {
                              round,
                              to: noteTo,
                              step: agentStep.name,
                              pieces,
                              says:
                                quiet !== null || had.of === 0
                                  ? noteSays
                                  : t('notes.had', { done: had.done, count: had.of }),
                              warn: quiet !== null,
                              send: (text: string, on: number | null) =>
                                postNote(text, noteAnchor(on)),
                              sendOn: (text, on) => postNote(text, on),
                            },
                          }
                        : reviewing
                          ? {
                              // While you review: a comment from the reader goes with a send-back,
                              // or stays a note of this round if you approve (the desk's rule).
                              review: {
                                says: reviewComments.length
                                  ? t('notes.review.notice', { count: reviewComments.length })
                                  : t('notes.review.phone'),
                                reader: readerNote ?? { onSend: (text, on) => postNote(text, on) },
                                commented: reviewComments.length > 0,
                              },
                            }
                          : {}),
                    }
                  : undefined
              }
            />
            {canRead ? (
              // A proof chip, or a note's cite on a line, opens the round's files here at that file:
              // the phone's own reader, as the desk opens its reader.
              <BottomSheet
                open={!!readAt?.open}
                label={t('phone.r.reader')}
                title={t('phone.r.reader')}
                className="p-sb p-read"
                onClose={closeReader}
              >
                {readAt?.open ? (
                  <div data-i="">
                    <EvidenceReader
                      evidence={reader.files}
                      at={readAt.at}
                      onAt={(at) => setReading({ item: item.id, at, open: true })}
                      phone
                      start={start}
                    />
                  </div>
                ) : null}
              </BottomSheet>
            ) : null}
          </ItemReview.Provider>
        </ItemEvidence.Provider>
      </ItemTypeScope>
    );
  }

  return (
    <ItemTypeScope type={type}>
      <ItemEvidence.Provider value={item.evidence}>
        <ItemReview.Provider value={review}>
          <div className="d-grid" ref={root}>
            <div className="sheet-bar" data-c>
              <Swap k={`${item.state}:${item.turn}:${look}`} as="div" className="crumb" dy={3}>
                <NodeGlyph look={look} size={14} />
                <span className="id">{item.id}</span>
                <StepPill
                  {...(yours
                    ? { tone: 'you' as const }
                    : item.turn === 'none'
                      ? { tone: 'none' as const }
                      : {})}
                >
                  {stateShown}
                </StepPill>
                {yours ? <span className="turn">{t('sheet.yourTurn')}</span> : null}
                <span className="ttag">
                  <TypeIcon name={type?.icon} size={13} />
                  {t('sheet.typeBoard', {
                    type: typeWord(type, item.type),
                    board: item.collection,
                  })}
                </span>
              </Swap>
              <div className="bar-r">
                {app.session.canConfigure && !app.phone && board ? (
                  <a
                    className="ghost-btn cz"
                    href={studioHash({ kind: 'board', board: board.id })}
                    aria-label={t('bs.home.editBoard')}
                  >
                    <Icon name="sliders" />
                    <span className="wl">{t('bs.home.editBoard')}</span>
                  </a>
                ) : null}
                <GhostButton
                  data-nav="-1"
                  aria-label={t('sheet.prev')}
                  disabled={!nav.prev}
                  onClick={() => onNav(-1)}
                >
                  ‹<span className="wl"> {t('sheet.prev')}</span>
                </GhostButton>
                <GhostButton
                  data-nav="1"
                  aria-label={t('sheet.next')}
                  disabled={!nav.next}
                  onClick={() => onNav(1)}
                >
                  <span className="wl">{t('sheet.next')} </span>›
                </GhostButton>
                <i className="vr" />
                <GhostButton
                  className="ampliar"
                  onClick={onFull}
                  aria-pressed={full}
                  aria-label={t('sheet.expand')}
                >
                  <Swap k={full ? 'r' : 'a'} className="swp" dy={3} outT={200} inT={300}>
                    <span className="wl">{full ? t('sheet.reduce') : t('sheet.expand')}</span>
                  </Swap>
                  <Icon name={full ? 'red' : 'amp'} />
                </GhostButton>
                <GhostButton className="closeb" onClick={onClose}>
                  {app.phone ? t('sheet.back') : t('sheet.close')}
                </GhostButton>
              </div>
            </div>
            <div className="d-head">
              <h1 className="headline" data-c>
                {item.title}
              </h1>
              {links ? <PartOfLine parent={links.parent} /> : null}
              <FromTurns turns={item.fromMessages} />
              <FromBandeja from={item.fromBandeja} />
              <div data-c>
                <Swap
                  k={`${stand.key}:${stand.agent ?? ''}:${stand.round ?? ''}:${stand.time ?? ''}:${silentHere}`}
                  as="p"
                  className="standfirst"
                  dy={4}
                >
                  {standText}
                </Swap>
              </div>
              {route}
              {hand.length ? (
                <HandChecklist item={item} rows={hand} canWrite={app.session.canWrite} />
              ) : null}
              {agentStep ? (
                <HandChecklist
                  item={item}
                  rows={agentHand}
                  canWrite={false}
                  canWaive={app.session.canWrite}
                  notes={roundNotes.length ? { unanswered } : undefined}
                />
              ) : null}
              {live ? <WaitChecklist rows={waits} child={partsName} now={now} /> : null}
              <Acts
                onDrop={live && dropChoices.length ? () => setDropping(true) : undefined}
                refuse={live ? refuse : undefined}
                ask={live ? careful.press : undefined}
                warning={careful.line}
                back={live ? (to: string) => backOf(live, item, to) : undefined}
                item={item}
                type={type}
                facts={facts}
                look={look}
                plan={actsPlan}
                mode={actsMode}
                pick={picking}
                word={word}
                notesOpen={notes?.open ? notes.choice : null}
                onNotes={openNotes}
                note={leave}
                unopened={unopenedLine}
              />
              {canRead ? (
                <DeskReader
                  open={!!readAt?.open}
                  onClose={closeReader}
                  evidence={reader.files}
                  at={readAt?.at ?? 0}
                  onAt={(at) => setReading({ item: item.id, at, open: true })}
                  parts={parts}
                  marks={reader.marks}
                  noted={noted}
                  seen={seen}
                  decide={decide}
                  start={start}
                  write={write}
                  note={readerNote}
                />
              ) : null}
              <div className="notes-slot">
                {noting ? (
                  <NotesForm
                    key="note"
                    open={noting.open}
                    agent={noteTo}
                    why={null}
                    button={noting.button}
                    belowTop={noting.below}
                    words={{
                      title: t('notes.form.title'),
                      aside: t('notes.form.for', { agent: who }),
                      placeholder: t('notes.form.placeholder'),
                      aria: t('notes.form.aria', { agent: who }),
                      send: t('notes.form.send'),
                    }}
                    extra={
                      pieces.length ? (
                        <div className="nt-anchor" data-i>
                          <div className="nt-apick-l">
                            <b>{t('notes.anchor.label')}</b>
                            <span>{t('notes.anchor.gloss', { n: round })}</span>
                          </div>
                          <AnchorPicker pieces={pieces} picked={anchor} onPick={setAnchor} />
                        </div>
                      ) : null
                    }
                    says={quiet !== null ? <span className="nt-quiet">{noteSays}</span> : noteSays}
                    onSend={sendNote}
                    onCancel={() => setNoting({ ...noting, open: false })}
                    onGone={() => setNoting((n) => (n && !n.open ? null : n))}
                  />
                ) : null}
                {notes ? (
                  <NotesForm
                    key={notes.choice.move.to}
                    open={notes.open}
                    agent={facts.agent}
                    why={notes.choice.kind === 'sendback' ? null : word(notes.choice.move.to)}
                    optional={
                      notes.choice.kind === 'sendback' && reviewComments.length
                        ? t('notes.review.optional')
                        : undefined
                    }
                    button={notes.button}
                    belowTop={notes.below}
                    draft={draftKeyOf(item.id, notes.choice.move.to)}
                    onSend={send}
                    onCancel={() => setNotes({ ...notes, open: false })}
                    onGone={() => setNotes((n) => (n && !n.open ? null : n))}
                  />
                ) : null}
              </div>
              <RequestChangedLine changed={item.requestChanged} />
              <BranchLine
                strip={strip}
                behind={behind}
                drift={drift}
                outside={outside}
                off={off}
                files={files}
                same={same}
                item={item.id}
                overlaps={overlaps}
                merge={merge}
                waits={item.landsAfter?.text}
                plain={plain}
              />
              {block?.request ? (
                <DraftRequestLine
                  request={block.request}
                  canConfigure={!!app.session.canConfigure && !app.phone}
                />
              ) : null}
            </div>
            {live ? (
              <DropDialog
                open={dropping}
                item={item}
                choices={dropChoices}
                branch={strip?.value || undefined}
                onClose={() => setDropping(false)}
                onDrop={drop}
              />
            ) : null}
            <Details cells={cells} k={`${item.state}:${item.updatedAt}`} />
            <div className="d-line" />
            <ItemTopics item={item} canWrite={app.session.canWrite} />
            <Body id={item.id} sections={sections} />
            <History id={item.id} lines={lines} />
          </div>
        </ItemReview.Provider>
      </ItemEvidence.Provider>
    </ItemTypeScope>
  );
}
