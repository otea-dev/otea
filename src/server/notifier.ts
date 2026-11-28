import type { DatabaseSync } from 'node:sqlite';
import { assistantFacts } from '../app/assistant-waiting.ts';
import { bandejaAskFacts } from '../app/bandeja.ts';
import { workersByBoard } from '../app/board-workers.ts';
import { listItems } from '../app/items.ts';
import { boardRoundOf, liveBoards } from '../app/next.ts';
import { notesSummary } from '../app/notes.ts';
import {
  DESKTOP,
  desktopChosen,
  desktopTarget,
  dropEndpoint,
  listTargets,
  type NotifyTarget,
} from '../app/notify-targets.ts';
import { pendingOf } from '../app/pending.ts';
import { listAgents } from '../app/presence.ts';
import type { Project } from '../app/project.ts';
import { setAsideOf } from '../app/set-aside.ts';
import { unheardOf } from '../app/unheard.ts';
import {
  aboutOf,
  type GroupNotice,
  groupOf,
  type ItemNotice,
  localMinuteOfDay,
  type Notice,
  Planner,
} from '../core/notify/planner.ts';
import {
  assistantSignalsOf,
  bandejaSignalsOf,
  freshSignals,
  type NotifyFacts,
  type NotifyKind,
  settleUnheard,
  signalsOf,
  unheardKey,
} from '../core/notify/signals.ts';
import { type NoticeLang, type NoticeText, noticeText } from '../core/notify/text.ts';
import { selectEvents } from '../store/queries.ts';
import type { ChangeFeed } from './changes.ts';
import type { PushSender } from './push.ts';
import { outcomeLine } from './test-push.ts';

// The server's side of notifications: it looks at the items on every change (and every few
// seconds, since a lease runs out without writing anything), finds what is new (core/notify), and
// hands each listener its notices: a push to every subscribed device, and to the desktop app, when
// it listens, its notices for the system's notifications. It looks only while someone listens.

export type DesktopListener = (text: NoticeText) => void;

export type Notifier = {
  // Looks at the items now.
  scan(): void;
  // Someone subscribed or left: starts or stops looking.
  refresh(): void;
  // The desktop app listens; `lang` words its notices until it chooses one in Preferencias, and
  // `end` is called when the server closes.
  listenDesktop(listener: DesktopListener, lang: NoticeLang, end?: () => void): () => void;
  // Every push sent so far has been answered (tests).
  settled(): Promise<void>;
  close(): void;
};

export type NotifierOptions = {
  sender: PushSender;
  // Where the devices and the desktop app that listen are kept: the machine store, shared by every
  // project this server serves (app/machine.ts).
  targets: DatabaseSync;
  now?: () => number;
  minuteOfDay?: (ms: number) => number;
  tickMs?: number;
  // Where each push's outcome is told (otea serve's output): the device id, never its endpoint.
  log?: (line: string) => void;
};

const TICK_MS = 5000;

// What stops being true leaves the person's shade: a question answered, an item no longer in their
// review. The kinds whose notice says «this waits for you»; a reply, a note answered or an item set
// aside is news that stays until read.
const WAITS: ReadonlySet<NotifyKind> = new Set(['turn', 'ask', 'stuck', 'unheard']);

// A notice a device was shown that may need closing, and when it was sent.
type Shown = { notice: ItemNotice | GroupNotice; at: number };

// How long a record of a shown notice is kept: past it the phone's own shade has dropped it.
const SHOWN_FOR_MS = 24 * 60 * 60_000;

// The things a notice is about, as `aboutOf` names them.
const aboutThe = (notice: ItemNotice | GroupNotice): { key: string; kind: NotifyKind }[] =>
  notice.kind === 'group'
    ? notice.items.map(({ item, kind, bandeja }) => ({
        key: aboutOf(bandeja ? { item, bandeja } : { item }),
        kind,
      }))
    : [
        {
          key: aboutOf(notice.bandeja ? { item: notice.item, bandeja: true } : notice),
          kind: notice.kind,
        },
      ];

function factsOf(project: Project, now: number): NotifyFacts[] {
  const boards = liveBoards(project);
  const clock = () => new Date(now).toISOString();
  const agents = listAgents(project.db, clock);
  const items = listItems(project, {}, clock);
  const workers = workersByBoard(project.db, items, agents, clock());
  return items.map((item) => {
    const setAside =
      item.turn === 'agent' ? setAsideOf(selectEvents(project.db, item.id)) : undefined;
    // Unheard now; scan() tells it only once it has stayed so for the grace (settleUnheard).
    const unheard = unheardOf(item, agents, clock(), setAside !== undefined, workers);
    const round = boardRoundOf(project, item, boards);
    const notes = notesSummary(project, item, boards);
    return {
      ...item,
      ...(unheard ? { unheard } : {}),
      ...(round === undefined ? {} : { round }),
      ...(notes === undefined ? {} : { notes }),
      ...(setAside === undefined ? {} : { setAside }),
    };
  });
}

export function createNotifier(
  project: Project,
  feed: ChangeFeed,
  options: NotifierOptions,
): Notifier {
  const targetsDb = options.targets;
  // A notice names its project and opens it: one phone and one desktop app hear every project.
  // A burst says it in its own words ("3 cosas te tocan en tienda-web").
  const { id, name } = project.identity;
  const words = (notice: Notice, lang: NoticeLang): NoticeText => {
    // A mixed burst says how many things wait for the person as `otea pending` counts them.
    let said = notice;
    if (notice.kind === 'group' && notice.of === 'mixed') {
      try {
        const waiting = pendingOf(project, undefined, { blocks: false }).count;
        if (waiting > 0) said = { ...notice, waiting };
      } catch (error) {
        options.log?.(`Otea notices: what waits could not be counted: ${String(error)}`);
      }
    }
    const text = noticeText(said, lang, { id, name });
    return {
      ...text,
      title: notice.kind === 'group' ? text.title : `${name} · ${text.title}`,
      url: `/p/${id}${text.url}`,
    };
  };
  const now = options.now ?? Date.now;
  const minuteOfDay = options.minuteOfDay ?? localMinuteOfDay;
  const planners = new Map<string, Planner>();
  const desktop = new Map<DesktopListener, { lang: NoticeLang; end?: () => void }>();
  const sending = new Set<Promise<void>>();
  let seen: Set<string> | undefined;
  // When each item's unheard stretch began; null for one already there when watching began.
  const unheardSince = new Map<string, number | null>();
  // The keys each source showed at its last good look.
  const kept = new Map<string, string[]>();
  let stopFeed: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  // What each phone was shown that may need closing, by device, then by the notice's tag.
  const shown = new Map<string, Map<string, Shown>>();

  const push = (target: NotifyTarget, text: NoticeText | { close: string }) => {
    const subscription = target.push;
    if (!subscription) return;
    const sent = options.sender
      .send(subscription, JSON.stringify(text))
      .then((outcome) => {
        options.log?.(
          `Otea ${outcomeLine(`push to device ${target.device ?? target.id}`, outcome)}`,
        );
        if (outcome.result !== 'gone') return;
        dropEndpoint(targetsDb, subscription.endpoint);
        refresh();
      })
      .catch((error: unknown) => {
        options.log?.(`Otea push to device ${target.device ?? target.id}: ${String(error)}`);
      })
      .finally(() => sending.delete(sent));
    sending.add(sent);
  };

  const listeners = (): NotifyTarget[] => {
    const targets = listTargets(targetsDb);
    if (desktop.size > 0) targets.push(desktopTarget(targetsDb));
    return targets;
  };

  const scan = () => {
    const at = now();
    // Each source on its own: one that throws is logged and the others still tell the person.
    // Items that failed to read are no reason to forget what was already seen (a failed look would
    // read as «everything went away»), so a failed look of the items ends this scan.
    const fromSource = (name: string, read: () => ReturnType<typeof signalsOf>) => {
      try {
        return read();
      } catch (error) {
        options.log?.(`Otea notices: the ${name} could not be read: ${String(error)}`);
        return undefined;
      }
    };
    const clock = () => new Date(at).toISOString();
    const items = fromSource('items', () => {
      const facts = factsOf(project, at);
      const unheard = new Set(facts.filter((f) => f.unheard).map(unheardKey));
      const told = settleUnheard(unheardSince, unheard, at, seen === undefined);
      return signalsOf(
        facts.map((f) => ({ ...f, unheard: told.has(unheardKey(f)) })),
        at,
      );
    });
    if (items === undefined) return;
    const assistant = fromSource('assistant', () =>
      assistantSignalsOf(assistantFacts(project.db, clock), at),
    );
    // A refiner's question on a Bandeja note waits for the person as an item's does.
    const bandeja = fromSource('Bandeja', () => bandejaSignalsOf(bandejaAskFacts(project, clock)));
    const signals = [...items, ...(assistant ?? []), ...(bandeja ?? [])];
    // A source that could not be read keeps what it showed before: those keys stay in `seen`, so a
    // notice waiting for them is not dropped, and they are not told again when it reads again.
    const carried = [
      ...(assistant === undefined ? (kept.get('assistant') ?? []) : []),
      ...(bandeja === undefined ? (kept.get('Bandeja') ?? []) : []),
    ];
    // Only a good look replaces what a source showed: after two failed looks in a row its keys
    // are still the last good ones.
    if (assistant !== undefined) {
      kept.set(
        'assistant',
        assistant.map(({ key }) => key),
      );
    }
    if (bandeja !== undefined) {
      kept.set(
        'Bandeja',
        bandeja.map(({ key }) => key),
      );
    }
    const fresh = freshSignals(seen, signals);
    seen = new Set([...signals.map(({ key }) => key), ...carried]);
    const targets = listeners();
    for (const id of planners.keys()) {
      if (!targets.some((target) => target.id === id)) planners.delete(id);
    }
    for (const target of targets) {
      let planner = planners.get(target.id);
      if (!planner) {
        planner = new Planner(minuteOfDay, id);
        planners.set(target.id, planner);
      }
      planner.offer(fresh, target.prefs, at);
      for (const notice of planner.take(at, seen, target.prefs)) {
        if (target.id !== DESKTOP) {
          const text = words(notice, target.lang);
          push(target, text);
          if (aboutThe(notice).some(({ kind }) => WAITS.has(kind))) {
            const own = shown.get(target.id) ?? new Map<string, Shown>();
            own.set(text.tag, { notice, at });
            shown.set(target.id, own);
          }
          continue;
        }
        // The language chosen in Preferencias, once it was; else the system's.
        const chose = desktopChosen(targetsDb);
        for (const [listener, { lang }] of desktop) {
          listener(words(notice, chose ? target.lang : lang));
        }
      }
    }
    // With a source unread, what it holds is unknown: nothing is closed on that look.
    if (assistant !== undefined && bandeja !== undefined) {
      closeGone(targets, new Set(signals.map((signal) => `${aboutOf(signal)}|${signal.kind}`)), at);
    }
  };

  // What a phone was told waits for the person and no longer does: its notice is closed on the
  // phone (a push the service worker answers without showing anything), and a burst's notice is
  // replaced with the count of what still waits. `held` are the things true now.
  const closeGone = (targets: readonly NotifyTarget[], held: ReadonlySet<string>, at: number) => {
    for (const [device, byTag] of shown) {
      const target = targets.find(({ id }) => id === device);
      if (!target) {
        shown.delete(device);
        continue;
      }
      for (const [tag, record] of byTag) {
        const { notice } = record;
        if (at - record.at > SHOWN_FOR_MS) {
          byTag.delete(tag);
          continue;
        }
        const gone = aboutThe(notice).map(
          ({ key, kind }) => WAITS.has(kind) && !held.has(`${key}|${kind}`),
        );
        if (!gone.includes(true)) continue;
        const left = notice.kind === 'group' ? notice.items.filter((_, i) => !gone[i]) : [];
        if (notice.kind !== 'group' || left.length === 0) {
          push(target, { close: tag });
          byTag.delete(tag);
          continue;
        }
        const next = groupOf(left);
        push(target, words(next, target.lang));
        if (aboutThe(next).some(({ kind }) => WAITS.has(kind))) {
          byTag.set(tag, { notice: next, at: record.at });
        } else byTag.delete(tag);
      }
      if (byTag.size === 0) shown.delete(device);
    }
  };

  const stop = () => {
    stopFeed?.();
    stopFeed = undefined;
    clearInterval(timer);
    timer = undefined;
    seen = undefined;
    unheardSince.clear();
    kept.clear();
    planners.clear();
    shown.clear();
  };

  const refresh = () => {
    let wanted = desktop.size > 0;
    try {
      wanted ||= listTargets(targetsDb).length > 0;
    } catch {
      wanted = false;
    }
    if (wanted && !stopFeed) {
      stopFeed = feed.subscribe(scan);
      timer = setInterval(scan, options.tickMs ?? TICK_MS);
      timer.unref?.();
      scan();
    } else if (!wanted && stopFeed) stop();
  };

  return {
    scan,
    refresh,
    listenDesktop(listener, lang, end) {
      desktop.set(listener, end ? { lang, end } : { lang });
      refresh();
      return () => {
        desktop.delete(listener);
        refresh();
      };
    },
    async settled() {
      while (sending.size > 0) await Promise.all(sending);
    },
    close() {
      const open = [...desktop.values()];
      desktop.clear();
      for (const { end } of open) end?.();
      stop();
    },
  };
}
